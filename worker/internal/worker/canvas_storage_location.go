package worker

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

const canvasStorageLocationPrefix = "s3-v1:"

var canvasOriginPattern = regexp.MustCompile(`(?i)^(https?)://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?/?$`)
var canvasStorageComponentPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
var canvasNumericHostEndPattern = regexp.MustCompile(`(?i)^(?:[0-9]+|0x[0-9a-f]*)$`)

type CanvasStorageLocation struct {
	ID       string `json:"id"`
	Endpoint string `json:"endpoint"`
	Region   string `json:"region"`
	Bucket   string `json:"bucket"`
}

func NewCanvasStorageLocation(endpoint, region, bucket string) (CanvasStorageLocation, error) {
	origin, err := canonicalCanvasStorageOrigin(trimCanvasWhitespace(endpoint))
	region = trimCanvasWhitespace(region)
	bucket = trimCanvasWhitespace(bucket)
	if err != nil || !canvasStorageComponentPattern.MatchString(region) || len(region) > 128 || !canvasStorageComponentPattern.MatchString(bucket) || len(bucket) > 255 {
		return CanvasStorageLocation{}, errors.New("canvas storage location is invalid")
	}
	// Accepted components contain no JSON/HTML-sensitive characters. This is the
	// exact UTF-8, whitespace-free array hashed by the Node adapter and fixtures.
	material, err := json.Marshal([3]string{origin, region, bucket})
	if err != nil {
		return CanvasStorageLocation{}, errors.New("canvas storage location cannot be encoded")
	}
	digest := sha256.Sum256(material)
	return CanvasStorageLocation{
		ID: canvasStorageLocationPrefix + hex.EncodeToString(digest[:]), Endpoint: origin, Region: region, Bucket: bucket,
	}, nil
}

func canonicalCanvasStorageOrigin(endpoint string) (string, error) {
	invalid := errors.New("canvas storage origin is invalid")
	parts := canvasOriginPattern.FindStringSubmatch(endpoint)
	if parts == nil {
		return "", invalid
	}
	scheme, host, port := strings.ToLower(parts[1]), strings.ToLower(parts[2]), parts[3]
	if strings.HasPrefix(host, "[") {
		address, err := netip.ParseAddr(host[1 : len(host)-1])
		if err != nil || !address.Is6() || "["+canvasIPv6String(address)+"]" != host {
			return "", invalid
		}
	} else {
		labels := strings.Split(strings.TrimSuffix(host, "."), ".")
		if canvasNumericHostEndPattern.MatchString(labels[len(labels)-1]) {
			address, err := netip.ParseAddr(host)
			if err != nil || !address.Is4() || address.String() != host {
				return "", invalid
			}
		}
	}
	if port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return "", invalid
		}
		if (scheme == "http" && number == 80) || (scheme == "https" && number == 443) {
			port = ""
		}
	}
	origin := scheme + "://" + host
	if port != "" {
		origin += ":" + port
	}
	if len(origin) > 512 {
		return "", invalid
	}
	return origin, nil
}

// WHATWG serializes mapped IPv6 addresses as hexadecimal, unlike netip.String's
// dotted-IPv4 suffix. Only this already-canonical representation is accepted.
func canvasIPv6String(address netip.Addr) string {
	bytes := address.As16()
	pieces := make([]string, 8)
	bestStart, bestLength := -1, 1
	for index := 0; index < len(pieces); {
		value := uint16(bytes[index*2])<<8 | uint16(bytes[index*2+1])
		pieces[index] = strconv.FormatUint(uint64(value), 16)
		if value != 0 {
			index++
			continue
		}
		start := index
		for index < len(pieces) && bytes[index*2] == 0 && bytes[index*2+1] == 0 {
			pieces[index] = "0"
			index++
		}
		if index-start > bestLength {
			bestStart, bestLength = start, index-start
		}
	}
	if bestStart < 0 {
		return strings.Join(pieces, ":")
	}
	return strings.Join(pieces[:bestStart], ":") + "::" + strings.Join(pieces[bestStart+bestLength:], ":")
}

func canvasWhitespace(value rune) bool {
	// ECMAScript trim/\s includes BOM but excludes Unicode's NEL character.
	return value == 0xFEFF || (value != 0x85 && unicode.IsSpace(value))
}

func trimCanvasWhitespace(value string) string {
	return strings.TrimFunc(value, canvasWhitespace)
}
