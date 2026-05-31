package worker

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"time"
)

type Config struct {
	AppURL                    string
	AuthSecret                string
	BuiltInProviderAPIKey     string
	BuiltInProviderBaseURL    string
	BuiltInProviderModel      string
	BuiltInProviderName       string
	BuiltInProviderCreditCost int
	Concurrency               int
	DatabaseURL               string
	EnableLocalImageFallback  bool
	HTTPAddr                  string
	JobTimeout                time.Duration
	MaxAttempts               int
	MetricsWindow             time.Duration
	PollInterval              time.Duration
	S3AccessKeyID             string
	S3Bucket                  string
	S3Endpoint                string
	S3PublicBaseURL           string
	S3Region                  string
	S3SecretAccessKey         string
	WorkerID                  string
}

func LoadConfig() (Config, error) {
	databaseURL := normalizeDatabaseURL(os.Getenv("DATABASE_URL"))
	authSecret := os.Getenv("AUTH_SECRET")
	if databaseURL == "" {
		return Config{}, errors.New("DATABASE_URL 不能为空")
	}
	if len(authSecret) < 10 {
		return Config{}, errors.New("AUTH_SECRET 不能为空，且至少 10 位")
	}

	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "local"
	}

	return Config{
		AppURL:                    getenv("APP_URL", "http://localhost:3000"),
		AuthSecret:                authSecret,
		BuiltInProviderAPIKey:     os.Getenv("BUILTIN_PROVIDER_API_KEY"),
		BuiltInProviderBaseURL:    os.Getenv("BUILTIN_PROVIDER_BASE_URL"),
		BuiltInProviderModel:      getenv("BUILTIN_PROVIDER_MODEL", "gpt-image-2"),
		BuiltInProviderName:       getenv("BUILTIN_PROVIDER_NAME", "Studio"),
		BuiltInProviderCreditCost: getenvInt("BUILTIN_PROVIDER_CREDIT_COST", 5),
		Concurrency:               getenvInt("WORKER_CONCURRENCY", 2),
		DatabaseURL:               databaseURL,
		EnableLocalImageFallback:  getenvBool("ENABLE_LOCAL_IMAGE_FALLBACK", true),
		HTTPAddr:                  getenv("WORKER_HTTP_ADDR", ":8081"),
		JobTimeout:                time.Duration(getenvInt("WORKER_JOB_TIMEOUT_SECONDS", 900)) * time.Second,
		MaxAttempts:               getenvInt("WORKER_MAX_ATTEMPTS", 2),
		MetricsWindow:             time.Duration(getenvInt("WORKER_METRICS_WINDOW_MINUTES", 1440)) * time.Minute,
		PollInterval:              time.Duration(getenvInt("WORKER_POLL_INTERVAL_MS", 1000)) * time.Millisecond,
		S3AccessKeyID:             os.Getenv("S3_ACCESS_KEY_ID"),
		S3Bucket:                  os.Getenv("S3_BUCKET"),
		S3Endpoint:                os.Getenv("S3_ENDPOINT"),
		S3PublicBaseURL:           os.Getenv("S3_PUBLIC_BASE_URL"),
		S3Region:                  getenv("S3_REGION", "auto"),
		S3SecretAccessKey:         os.Getenv("S3_SECRET_ACCESS_KEY"),
		WorkerID:                  fmt.Sprintf("%s-%d", hostname, os.Getpid()),
	}, nil
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func getenvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func getenvBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value == "true" || value == "1" || value == "yes"
}

func normalizeDatabaseURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}

	query := parsed.Query()
	if schema := query.Get("schema"); schema != "" {
		query.Del("schema")
		if query.Get("search_path") == "" {
			query.Set("search_path", schema)
		}
		parsed.RawQuery = query.Encode()
	}

	return parsed.String()
}
