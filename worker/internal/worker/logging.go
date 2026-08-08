package worker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
)

const redactedValue = "[REDACTED]"

var (
	credentialPattern = regexp.MustCompile(`(?i)\b(authorization|x-api-key|api[_-]?key|auth[_-]?secret|database[_-]?url)\b\s*[:=]\s*(?:bearer\s+)?[^\s,;]+`)
	urlPattern        = regexp.MustCompile(`(?i)\b(?:postgres(?:ql)?|https?)://[^\s"'<>]+`)
)

func ParseLogLevel(raw string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "info":
		return slog.LevelInfo, nil
	case "debug":
		return slog.LevelDebug, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("LOG_LEVEL 必须是 debug、info、warn 或 error")
	}
}

func NewJSONLogger(output io.Writer, level slog.Level) *slog.Logger {
	handler := slog.NewJSONHandler(output, &slog.HandlerOptions{Level: level})
	return slog.New(&redactingHandler{next: handler})
}

type redactingHandler struct {
	next slog.Handler
}

func (handler *redactingHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return handler.next.Enabled(ctx, level)
}

func (handler *redactingHandler) Handle(ctx context.Context, record slog.Record) error {
	clean := slog.NewRecord(record.Time, record.Level, record.Message, record.PC)
	record.Attrs(func(attr slog.Attr) bool {
		clean.AddAttrs(redactLogAttr(attr))
		return true
	})
	return handler.next.Handle(ctx, clean)
}

func (handler *redactingHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	clean := make([]slog.Attr, 0, len(attrs))
	for _, attr := range attrs {
		clean = append(clean, redactLogAttr(attr))
	}
	return &redactingHandler{next: handler.next.WithAttrs(clean)}
}

func (handler *redactingHandler) WithGroup(name string) slog.Handler {
	return &redactingHandler{next: handler.next.WithGroup(name)}
}

func redactLogAttr(attr slog.Attr) slog.Attr {
	attr.Value = attr.Value.Resolve()
	key := strings.ToLower(attr.Key)
	if isFullySensitiveLogKey(key) {
		return slog.String(attr.Key, redactedValue)
	}
	if strings.Contains(key, "url") || strings.Contains(key, "dsn") {
		return slog.String(attr.Key, redactSensitiveText(attr.Value.String()))
	}
	if key == "error" || key == "cause" {
		if err, ok := attr.Value.Any().(error); ok {
			return slog.String(attr.Key, safeLogError(err))
		}
		return slog.String(attr.Key, redactSensitiveText(attr.Value.String()))
	}
	if attr.Value.Kind() == slog.KindGroup {
		attrs := attr.Value.Group()
		clean := make([]slog.Attr, 0, len(attrs))
		for _, nested := range attrs {
			clean = append(clean, redactLogAttr(nested))
		}
		return slog.Group(attr.Key, attrsToAny(clean)...)
	}
	if attr.Value.Kind() == slog.KindString {
		return slog.String(attr.Key, redactSensitiveText(attr.Value.String()))
	}
	if attr.Value.Kind() == slog.KindAny {
		if err, ok := attr.Value.Any().(error); ok {
			return slog.String(attr.Key, safeLogError(err))
		}
	}
	return attr
}

func attrsToAny(attrs []slog.Attr) []any {
	values := make([]any, 0, len(attrs))
	for _, attr := range attrs {
		values = append(values, attr)
	}
	return values
}

func isFullySensitiveLogKey(key string) bool {
	for _, fragment := range []string{
		"authorization", "api_key", "apikey", "auth_secret", "database_url",
		"header", "request_body", "response_body", "provider_body", "secret", "token",
	} {
		if strings.Contains(key, fragment) {
			return true
		}
	}
	return false
}

func safeLogError(err error) string {
	if err == nil {
		return ""
	}

	var contractFailure ContractFailure
	if errors.As(err, &contractFailure) && contractFailure.Code != "" {
		return contractFailure.Code
	}
	var providerFailure ProviderHTTPError
	if errors.As(err, &providerFailure) {
		return fmt.Sprintf("渠道请求失败：HTTP %d", providerFailure.StatusCode)
	}
	var persistFailure ResultPersistError
	if errors.As(err, &persistFailure) && persistFailure.Cause != nil {
		return "生成结果写回存储失败：" + safeLogError(persistFailure.Cause)
	}
	var urlFailure *url.Error
	if errors.As(err, &urlFailure) {
		return redactSensitiveText(urlFailure.Op + " " + urlFailure.URL + ": " + urlFailure.Err.Error())
	}
	return redactSensitiveText(err.Error())
}

func redactSensitiveText(value string) string {
	value = credentialPattern.ReplaceAllStringFunc(value, func(match string) string {
		separator := strings.IndexAny(match, ":=")
		if separator < 0 {
			return redactedValue
		}
		return strings.TrimSpace(match[:separator]) + "=" + redactedValue
	})
	return urlPattern.ReplaceAllStringFunc(value, redactURL)
}

func redactURL(raw string) string {
	trimmed := strings.TrimRight(raw, ".,;)]}")
	suffix := strings.TrimPrefix(raw, trimmed)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return redactedValue + suffix
	}
	parsed.Fragment = ""
	parsed.RawQuery = ""
	if parsed.Scheme == "postgres" || parsed.Scheme == "postgresql" {
		return parsed.Scheme + "://" + redactedValue + "@" + parsed.Host + parsed.EscapedPath() + suffix
	}
	return parsed.String() + suffix
}
