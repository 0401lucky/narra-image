package worker

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func historyReaderIncompatible() error {
	return ImageHistoryIOError{Code: "IMAGE_READER_INCOMPATIBLE"}
}

// VerifyPublishedReader is only used for an explicitly requested retirement,
// after the internal target readback/switch. A reachable canonical public
// response proves the deployed reader serves the exact immutable image. It
// never uses S3 credentials, cookies, redirects, retries, or a candidate URL.
func (writer *ImageHistoryWriter) VerifyPublishedReader(ctx context.Context, canonicalURL string, expected ImageHistoryExpectedContent) error {
	parsed, err := url.Parse(canonicalURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || len(canonicalURL) > 2048 ||
		expected.ByteLength < 1 || expected.ByteLength > ImageMaxBytes || !imagePublicTokenPattern.MatchString(expected.SHA256) || expected.MimeType == "" {
		return historyReaderIncompatible()
	}
	marker := strings.LastIndex(canonicalURL, "/media/images/")
	if marker < 0 || !imagePublicTokenPattern.MatchString(canonicalURL[marker+len("/media/images/"):]) {
		return historyReaderIncompatible()
	}
	readCtx, cancel := context.WithTimeout(ctx, time.Duration(ImageReadTimeoutMilliseconds)*time.Millisecond)
	defer cancel()
	// One fresh HTTP/1 connection avoids both reused-connection GET retries and
	// HTTP/2 stream retries. Proxy credentials are not inherited for this proof.
	transport := &http.Transport{
		DialContext:       (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: -1}).DialContext,
		DisableKeepAlives: true, DisableCompression: true,
		TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: time.Duration(ImageReadTimeoutMilliseconds) * time.Millisecond,
		TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: time.Duration(ImageReadTimeoutMilliseconds) * time.Millisecond,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(readCtx, http.MethodGet, canonicalURL, nil)
	if err != nil {
		return historyReaderIncompatible()
	}
	request.Header.Set("Accept", expected.MimeType)
	response, err := client.Do(request)
	if err != nil {
		return historyReaderIncompatible()
	}
	defer response.Body.Close()
	stopAbort := context.AfterFunc(readCtx, func() { _ = response.Body.Close() })
	defer stopAbort()
	if response.StatusCode != http.StatusOK || (response.ContentLength >= 0 && response.ContentLength != expected.ByteLength) {
		return historyReaderIncompatible()
	}
	observed, err := readImageHistoryContent(readCtx, response.Body, expected.ByteLength, &expected, false)
	if err != nil || observed.ReadResult != "FULL" {
		return historyReaderIncompatible()
	}
	return nil
}

func (runner *imageHistoryRunner) verifyPublished(ctx context.Context, item ImageHistoryItem) error {
	if item.AssetID == nil || item.TargetObjectID == nil || item.Target == nil || item.ReplicaVerificationID == nil {
		return historyReaderIncompatible()
	}
	lease, err := runner.repository.BeginRead(ctx, ImageReadInput{AssetID: *item.AssetID})
	if err != nil {
		return err
	}
	if lease == nil || lease.Image.Asset.ID != *item.AssetID || lease.Image.Object == nil || lease.Image.Object.ID != *item.TargetObjectID ||
		lease.Image.Object.SHA256 != item.Target.Object.SHA256 || lease.Image.Object.ByteLength != item.Target.Object.ByteLength || !ImageObjectVerified(*lease.Image.Object) {
		return historyReaderIncompatible()
	}
	canonicalURL, err := ImagePublicURL(runner.job.PublicURLBase, lease.Image.Asset.PublicToken)
	if err != nil {
		return historyReaderIncompatible()
	}
	readCtx, cancel := historyReadContext(ctx, lease.ReadExpiresAt)
	defer cancel()
	return runner.storage.VerifyPublishedReader(readCtx, canonicalURL, ImageHistoryExpectedContent{ByteLength: lease.Image.Object.ByteLength, SHA256: lease.Image.Object.SHA256, MimeType: lease.Image.Object.MimeType})
}
