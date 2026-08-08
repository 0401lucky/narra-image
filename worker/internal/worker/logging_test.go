package worker

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

func TestJSONLoggerRedactsCredentialsProviderBodiesAndSignedURLs(t *testing.T) {
	var output bytes.Buffer
	logger := NewJSONLogger(&output, slog.LevelDebug)
	logger.Error(
		"provider request failed",
		"error", ProviderHTTPError{StatusCode: 500, Summary: "upstream-body-secret"},
		"database_url", "postgresql://admin:database-password@db/app?token=db-token",
		"authorization", "Bearer auth-token",
		"provider_body", "raw-provider-body",
		"url", "https://cdn.example/image.png?X-Amz-Signature=signed-secret",
	)

	line := output.String()
	for _, secret := range []string{
		"upstream-body-secret",
		"database-password",
		"db-token",
		"auth-token",
		"raw-provider-body",
		"signed-secret",
	} {
		if strings.Contains(line, secret) {
			t.Fatalf("log leaked %q: %s", secret, line)
		}
	}
	if !strings.Contains(line, redactedValue) || !strings.Contains(line, `"level":"ERROR"`) {
		t.Fatalf("unexpected redacted JSON log: %s", line)
	}
}

func TestSafeLogErrorRedactsDatabaseURL(t *testing.T) {
	got := safeLogError(errors.New("connect postgresql://admin:password@db/app?sslmode=require failed"))
	if strings.Contains(got, "password") || strings.Contains(got, "sslmode") {
		t.Fatalf("error was not redacted: %s", got)
	}
	if !strings.Contains(got, redactedValue) {
		t.Fatalf("redacted marker missing: %s", got)
	}
}

func TestParseLogLevelRejectsUnknownLevel(t *testing.T) {
	if _, err := ParseLogLevel("verbose"); err == nil {
		t.Fatal("expected invalid log level error")
	}
}
