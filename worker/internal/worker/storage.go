package worker

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const probeMaxBytes = 64 * 1024
const remoteImageMaxBytes = 50 * 1024 * 1024
const sourceImagesTotalMaxBytes = 32 * 1024 * 1024
const referenceImageMaxRedirects = 5

// MediaStorage 标识生成结果的持久化形态，随 GenerationImage/GeneratedVideo 落库。
// B64 仅允许开发/测试 data URL fallback；S3 是生产强制形态；
// UPSTREAM 表示上游直连，仅历史数据，新写入不会产生。
type MediaStorage string

const (
	MediaStorageB64      MediaStorage = "B64"
	MediaStorageS3       MediaStorage = "S3"
	MediaStorageUpstream MediaStorage = "UPSTREAM"
)

// PersistedMedia 是一次持久化操作的结果：公开 URL、存储形态与 S3 object key。
// 非 S3 形态的 StorageKey 为空。
type PersistedMedia struct {
	URL          string
	MediaStorage MediaStorage
	StorageKey   string
}

// objectStorageClient 抽象 S3 客户端以便测试注入，生产由 *s3.Client 满足。
type objectStorageClient interface {
	PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

type Storage struct {
	client objectStorageClient
	cfg    Config
}

type SourceImage struct {
	Data     []byte
	FileName string
	MimeType string
}

type PersistedRemoteImage struct {
	Data         []byte
	MimeType     string
	URL          string
	MediaStorage MediaStorage
	StorageKey   string
}

func NewStorage(ctx context.Context, cfg Config) (*Storage, error) {
	storage := &Storage{cfg: cfg}
	if cfg.S3Bucket == "" || cfg.S3Endpoint == "" || cfg.S3AccessKeyID == "" || cfg.S3SecretAccessKey == "" {
		return storage, nil
	}

	awsConfig, err := config.LoadDefaultConfig(
		ctx,
		config.WithRegion(cfg.S3Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.S3AccessKeyID,
			cfg.S3SecretAccessKey,
			"",
		)),
	)
	if err != nil {
		return nil, err
	}

	storage.client = s3.NewFromConfig(awsConfig, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(cfg.S3Endpoint)
		options.UsePathStyle = true
	})
	return storage, nil
}

func (s *Storage) PersistImage(ctx context.Context, userID string, data []byte, extension string, mimeType string) (PersistedMedia, error) {
	if extension == "" {
		extension = "png"
	}
	if mimeType == "" {
		mimeType = "image/png"
	}

	if s.client != nil && s.cfg.S3Bucket != "" {
		fileName := fmt.Sprintf("%s/%s.%s", userID, randomHex(16), extension)
		_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
			Body:        bytes.NewReader(data),
			Bucket:      aws.String(s.cfg.S3Bucket),
			ContentType: aws.String(mimeType),
			Key:         aws.String(fileName),
		})
		if err != nil {
			return PersistedMedia{}, err
		}

		return PersistedMedia{
			URL:          s.publicObjectURL(fileName),
			MediaStorage: MediaStorageS3,
			StorageKey:   fileName,
		}, nil
	}

	if s.cfg.EnableLocalImageFallback {
		// 生产环境禁止把大 base64 作为数据库主存储；即使显式开启 fallback 也拒绝。
		if s.cfg.isProductionEnvironment() {
			return PersistedMedia{}, errors.New("生产环境禁止 data URL 图片存储，请配置对象存储（S3/R2）")
		}
		return PersistedMedia{
			URL:          fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(data)),
			MediaStorage: MediaStorageB64,
		}, nil
	}

	return PersistedMedia{}, errors.New("当前没有可用的图片存储配置")
}

func (s *Storage) PersistImageFromURL(
	ctx context.Context,
	userID string,
	rawURL string,
	client *http.Client,
) (PersistedRemoteImage, error) {
	image, err := downloadRemoteImage(ctx, rawURL, client)
	if err != nil {
		return PersistedRemoteImage{}, err
	}

	persisted, err := s.PersistImage(ctx, userID, image.Data, extensionFromMime(image.MimeType), image.MimeType)
	if err != nil {
		return PersistedRemoteImage{}, err
	}

	return PersistedRemoteImage{
		Data:         image.Data,
		MimeType:     image.MimeType,
		URL:          persisted.URL,
		MediaStorage: persisted.MediaStorage,
		StorageKey:   persisted.StorageKey,
	}, nil
}

func (s *Storage) PersistVideo(ctx context.Context, userID string, data []byte) (PersistedMedia, error) {
	if s.client != nil && s.cfg.S3Bucket != "" {
		fileName := fmt.Sprintf("%s/%s.mp4", userID, randomHex(16))
		_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
			Body:        bytes.NewReader(data),
			Bucket:      aws.String(s.cfg.S3Bucket),
			ContentType: aws.String("video/mp4"),
			Key:         aws.String(fileName),
		})
		if err != nil {
			return PersistedMedia{}, err
		}

		return PersistedMedia{
			URL:          s.publicObjectURL(fileName),
			MediaStorage: MediaStorageS3,
			StorageKey:   fileName,
		}, nil
	}

	// 视频不提供 data URL 或上游 URL 回退：没有对象存储即明确失败，
	// 避免把依赖短期上游 URL 的地址写入数据库。
	return PersistedMedia{}, errors.New("未配置对象存储（S3/R2），无法持久化视频结果")
}

// publicObjectURL 根据公开访问域名或 S3 端点构造对象公开 URL。
func (s *Storage) publicObjectURL(fileName string) string {
	if s.cfg.S3PublicBaseURL != "" {
		return strings.TrimRight(s.cfg.S3PublicBaseURL, "/") + "/" + fileName
	}
	return strings.TrimRight(s.cfg.S3Endpoint, "/") + "/" + s.cfg.S3Bucket + "/" + fileName
}

// hasObjectStorage 表示是否配置了可用的 S3 对象存储。
func (s *Storage) hasObjectStorage() bool {
	return s.client != nil && s.cfg.S3Bucket != ""
}

// HasObjectStorage 导出给运维命令（如 backfill-media）判断对象存储是否就绪。
func (s *Storage) HasObjectStorage() bool {
	return s.hasObjectStorage()
}

// isProductionEnvironment 判断是否处于生产语义：NODE_ENV=production，或
// APP_URL 被显式配置为非 loopback 地址。默认 loopback 值视为开发/测试。
func (cfg Config) isProductionEnvironment() bool {
	if strings.EqualFold(strings.TrimSpace(cfg.NodeEnv), "production") {
		return true
	}
	appURL := strings.TrimSpace(cfg.AppURL)
	if appURL == "" || appURL == "http://localhost:3000" {
		return false
	}
	parsed, err := url.Parse(appURL)
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "0.0.0.0" || host == "::1" || strings.HasSuffix(host, ".localhost") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsUnspecified()) {
		return false
	}
	return true
}

func loadSourceImages(ctx context.Context, urls []string) ([]SourceImage, error) {
	images := make([]SourceImage, 0, len(urls))
	totalBytes := 0
	for index, rawURL := range urls {
		image, err := loadSourceImage(ctx, rawURL, index)
		if err != nil {
			return nil, err
		}
		images, totalBytes, err = appendSourceImage(images, totalBytes, image)
		if err != nil {
			return nil, err
		}
	}
	return images, nil
}

func appendSourceImage(
	images []SourceImage,
	totalBytes int,
	image SourceImage,
) ([]SourceImage, int, error) {
	nextTotal := totalBytes + len(image.Data)
	if nextTotal > sourceImagesTotalMaxBytes {
		return nil, totalBytes, errors.New("参考图总大小超过 32MB")
	}
	return append(images, image), nextTotal, nil
}

func loadSourceImage(ctx context.Context, rawURL string, index int) (SourceImage, error) {
	if strings.HasPrefix(rawURL, "data:") {
		return parseDataURL(rawURL, index)
	}
	if err := validateReferenceURL(rawURL); err != nil {
		return SourceImage{}, err
	}

	return loadSourceImageWithClient(ctx, newReferenceImageHTTPClient(), rawURL, index)
}

func loadSourceImageWithClient(ctx context.Context, client *http.Client, rawURL string, index int) (SourceImage, error) {

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return SourceImage{}, err
	}
	response, err := client.Do(request)
	if err != nil {
		return SourceImage{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return SourceImage{}, fmt.Errorf("参考图下载失败：HTTP %d", response.StatusCode)
	}

	if response.ContentLength > remoteImageMaxBytes {
		return SourceImage{}, errors.New("参考图过大，最大允许 50MB")
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, remoteImageMaxBytes+1))
	if err != nil {
		return SourceImage{}, err
	}
	if len(data) > remoteImageMaxBytes {
		return SourceImage{}, errors.New("参考图过大，最大允许 50MB")
	}
	mimeType, err := validatedImageMimeType(response.Header.Get("content-type"), data)
	if err != nil {
		return SourceImage{}, err
	}

	return SourceImage{
		Data:     data,
		FileName: sourceFileName(rawURL, mimeType, index),
		MimeType: mimeType,
	}, nil
}

func downloadRemoteImage(ctx context.Context, rawURL string, client *http.Client) (SourceImage, error) {
	if strings.HasPrefix(rawURL, "data:") {
		return parseDataURL(rawURL, 0)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return SourceImage{}, err
	}
	response, err := client.Do(request)
	if err != nil {
		return SourceImage{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return SourceImage{}, fmt.Errorf("远程图片下载失败：HTTP %d", response.StatusCode)
	}

	if response.ContentLength > remoteImageMaxBytes {
		return SourceImage{}, errors.New("远程图片过大，无法保存")
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, remoteImageMaxBytes+1))
	if err != nil {
		return SourceImage{}, err
	}
	if len(data) > remoteImageMaxBytes {
		return SourceImage{}, errors.New("远程图片过大，无法保存")
	}

	mimeType, err := validatedImageMimeType(response.Header.Get("content-type"), data)
	if err != nil {
		return SourceImage{}, err
	}
	return SourceImage{
		Data:     data,
		FileName: sourceFileName(rawURL, mimeType, 0),
		MimeType: mimeType,
	}, nil
}

func parseDataURL(rawURL string, index int) (SourceImage, error) {
	header, payload, ok := strings.Cut(rawURL, ",")
	if !ok {
		return SourceImage{}, errors.New("参考图 data URL 格式无效")
	}
	mimeType := strings.TrimPrefix(header, "data:")
	if semicolon := strings.Index(mimeType, ";"); semicolon >= 0 {
		mimeType = mimeType[:semicolon]
	}
	if mimeType == "" {
		mimeType = "image/png"
	}
	if !strings.Contains(strings.ToLower(header), ";base64") {
		return SourceImage{}, errors.New("参考图 data URL 必须使用 base64 编码")
	}
	if base64.StdEncoding.DecodedLen(len(payload)) > remoteImageMaxBytes {
		return SourceImage{}, errors.New("参考图过大，最大允许 50MB")
	}

	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return SourceImage{}, err
	}
	if len(data) > remoteImageMaxBytes {
		return SourceImage{}, errors.New("参考图过大，最大允许 50MB")
	}
	mimeType, err = validatedImageMimeType(mimeType, data)
	if err != nil {
		return SourceImage{}, err
	}

	return SourceImage{
		Data:     data,
		FileName: fmt.Sprintf("source-%d.%s", index+1, extensionFromMime(mimeType)),
		MimeType: mimeType,
	}, nil
}

func newReferenceImageHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			for _, ip := range ips {
				if !isPublicReferenceIP(ip) {
					continue
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			}
			return nil, errors.New("参考图地址解析到非公网 IP")
		},
	}

	return &http.Client{
		Transport: transport,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= referenceImageMaxRedirects {
				return errors.New("参考图重定向次数过多")
			}
			return validateReferenceURL(request.URL.String())
		},
	}
}

func providerHTTPClient(allowPrivateNetwork bool) *http.Client {
	if allowPrivateNetwork {
		return http.DefaultClient
	}
	return newReferenceImageHTTPClient()
}

func validateReferenceURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return errors.New("参考图 URL 格式无效")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("参考图 URL 仅支持 http 或 https")
	}
	if parsed.Hostname() == "" || parsed.User != nil {
		return errors.New("参考图 URL 地址无效")
	}
	if ip := net.ParseIP(parsed.Hostname()); ip != nil && !isPublicReferenceIP(ip) {
		return errors.New("参考图 URL 不允许访问内网地址")
	}
	return nil
}

func isPublicReferenceIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return false
	}
	// Go 的 IsPrivate 不包含共享地址空间 100.64.0.0/10。
	sharedAddressSpace := &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}
	return !sharedAddressSpace.Contains(ip)
}

func validatedImageMimeType(headerValue string, data []byte) (string, error) {
	detected := http.DetectContentType(data)
	mediaType, _, err := mime.ParseMediaType(detected)
	if err != nil || !strings.HasPrefix(mediaType, "image/") {
		return "", errors.New("参考图内容不是有效图片")
	}

	headerType, _, headerErr := mime.ParseMediaType(headerValue)
	if headerErr == nil && strings.HasPrefix(headerType, "image/") && headerType != mediaType {
		return "", errors.New("参考图 MIME 类型与内容不一致")
	}
	return mediaType, nil
}

func fetchAndProbeDimensions(ctx context.Context, rawURL string) *ImageDimensions {
	if !strings.HasPrefix(strings.ToLower(rawURL), "http://") &&
		!strings.HasPrefix(strings.ToLower(rawURL), "https://") {
		return nil
	}

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil
	}
	request.Header.Set("Range", fmt.Sprintf("bytes=0-%d", probeMaxBytes-1))

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil
	}

	limited := io.LimitReader(response.Body, probeMaxBytes)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil
	}
	return readImageDimensions(data)
}

func sourceFileName(rawURL string, mimeType string, index int) string {
	parsed, err := url.Parse(rawURL)
	if err == nil {
		base := path.Base(parsed.Path)
		if base != "." && base != "/" && base != "" {
			return base
		}
	}
	return fmt.Sprintf("source-%d.%s", index+1, extensionFromMime(mimeType))
}

func extensionFromMime(mimeType string) string {
	mediaType, _, err := mime.ParseMediaType(mimeType)
	if err != nil {
		mediaType = mimeType
	}
	switch mediaType {
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/webp":
		return "webp"
	case "image/gif":
		return "gif"
	default:
		return "png"
	}
}

func imageMimeType(headerValue string, data []byte) string {
	mediaType, _, err := mime.ParseMediaType(headerValue)
	if err == nil && strings.HasPrefix(mediaType, "image/") {
		return mediaType
	}

	detected := http.DetectContentType(data)
	mediaType, _, err = mime.ParseMediaType(detected)
	if err == nil && strings.HasPrefix(mediaType, "image/") {
		return mediaType
	}

	return "image/png"
}

func randomHex(size int) string {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}
