package worker

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppURL                         string
	AuthSecret                     string
	BuiltInProviderAPIKey          string
	BuiltInProviderBaseURL         string
	BuiltInProviderModel           string
	BuiltInProviderName            string
	BuiltInProviderCreditCost      int
	Concurrency                    int
	ContractsV1Enabled             bool
	DatabaseURL                    string
	EnableLocalImageFallback       bool
	HTTPAddr                       string
	JobTimeout                     time.Duration
	LogLevel                       slog.Level
	MaxAttempts                    int
	MaxActivePerUser               int
	MetricsToken                   string
	MetricsWindow                  time.Duration
	PollInterval                   time.Duration
	RetryBaseDelay                 time.Duration
	RuntimeMode                    RuntimeMode
	ShutdownGrace                  time.Duration
	ShutdownHardTimeout            time.Duration
	VideoPollInterval              time.Duration
	BuiltInProviderVideoCreditCost int
	BuiltInProviderVideoModel      string
	S3AccessKeyID                  string
	S3Bucket                       string
	S3Endpoint                     string
	S3PublicBaseURL                string
	S3Region                       string
	S3SecretAccessKey              string
	WorkerID                       string
}

func LoadConfig() (Config, error) {
	databaseURL, err := LoadDatabaseURL()
	if err != nil {
		return Config{}, err
	}
	authSecret := strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	if len(authSecret) < 10 {
		return Config{}, errors.New("AUTH_SECRET 不能为空，且至少 10 位")
	}
	if isPublicAuthSecret(authSecret) {
		return Config{}, errors.New("AUTH_SECRET 不能使用公开占位值")
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") && len(authSecret) < 32 {
		return Config{}, errors.New("生产环境 AUTH_SECRET 至少需要 32 位")
	}

	runtimeMode, err := loadRuntimeMode(os.Getenv("WORKER_RUNTIME_MODE"))
	if err != nil {
		return Config{}, err
	}
	logLevel, err := ParseLogLevel(os.Getenv("LOG_LEVEL"))
	if err != nil {
		return Config{}, err
	}
	metricsToken := strings.TrimSpace(os.Getenv("WORKER_METRICS_TOKEN"))
	if metricsToken != "" && len(metricsToken) < 16 {
		return Config{}, errors.New("WORKER_METRICS_TOKEN 设置后至少需要 16 位")
	}
	hardTimeoutSeconds, err := getenvBoundedInt("WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS", 10, 1, 300)
	if err != nil {
		return Config{}, err
	}

	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "local"
	}

	return Config{
		AppURL:                         getenv("APP_URL", "http://localhost:3000"),
		AuthSecret:                     authSecret,
		BuiltInProviderAPIKey:          os.Getenv("BUILTIN_PROVIDER_API_KEY"),
		BuiltInProviderBaseURL:         os.Getenv("BUILTIN_PROVIDER_BASE_URL"),
		BuiltInProviderModel:           getenv("BUILTIN_PROVIDER_MODEL", "gpt-image-2"),
		BuiltInProviderName:            getenv("BUILTIN_PROVIDER_NAME", "Studio"),
		BuiltInProviderCreditCost:      getenvInt("BUILTIN_PROVIDER_CREDIT_COST", 5),
		Concurrency:                    getenvInt("WORKER_CONCURRENCY", 2),
		ContractsV1Enabled:             getenvBool("WORKER_CONTRACTS_V1_ENABLED", false),
		DatabaseURL:                    databaseURL,
		EnableLocalImageFallback:       getenvBool("ENABLE_LOCAL_IMAGE_FALLBACK", true),
		HTTPAddr:                       getenv("WORKER_HTTP_ADDR", "127.0.0.1:8081"),
		JobTimeout:                     time.Duration(getenvInt("WORKER_JOB_TIMEOUT_SECONDS", 900)) * time.Second,
		LogLevel:                       logLevel,
		MaxAttempts:                    getenvInt("WORKER_MAX_ATTEMPTS", 2),
		MaxActivePerUser:               getenvInt("WORKER_MAX_ACTIVE_PER_USER", 1),
		MetricsToken:                   metricsToken,
		MetricsWindow:                  time.Duration(getenvInt("WORKER_METRICS_WINDOW_MINUTES", 1440)) * time.Minute,
		PollInterval:                   time.Duration(getenvInt("WORKER_POLL_INTERVAL_MS", 1000)) * time.Millisecond,
		RetryBaseDelay:                 time.Duration(getenvInt("WORKER_RETRY_BASE_DELAY_MS", 1000)) * time.Millisecond,
		RuntimeMode:                    runtimeMode,
		ShutdownGrace:                  time.Duration(getenvInt("WORKER_SHUTDOWN_GRACE_SECONDS", 30)) * time.Second,
		ShutdownHardTimeout:            time.Duration(hardTimeoutSeconds) * time.Second,
		VideoPollInterval:              time.Duration(getenvInt("WORKER_VIDEO_POLL_INTERVAL_MS", 5000)) * time.Millisecond,
		BuiltInProviderVideoCreditCost: getenvInt("BUILTIN_PROVIDER_VIDEO_CREDIT_COST", 20),
		BuiltInProviderVideoModel:      getenv("BUILTIN_PROVIDER_VIDEO_MODEL", "sora-2"),
		S3AccessKeyID:                  os.Getenv("S3_ACCESS_KEY_ID"),
		S3Bucket:                       os.Getenv("S3_BUCKET"),
		S3Endpoint:                     os.Getenv("S3_ENDPOINT"),
		S3PublicBaseURL:                os.Getenv("S3_PUBLIC_BASE_URL"),
		S3Region:                       getenv("S3_REGION", "auto"),
		S3SecretAccessKey:              os.Getenv("S3_SECRET_ACCESS_KEY"),
		WorkerID:                       fmt.Sprintf("%s-%d", hostname, os.Getpid()),
	}, nil
}

func loadRuntimeMode(raw string) (RuntimeMode, error) {
	switch RuntimeMode(strings.ToLower(strings.TrimSpace(raw))) {
	case RuntimeModeEmbedded:
		return RuntimeModeEmbedded, nil
	case RuntimeModeDedicated:
		return RuntimeModeDedicated, nil
	default:
		return "", errors.New("WORKER_RUNTIME_MODE 必须明确设置为 embedded 或 dedicated")
	}
}

func isPublicAuthSecret(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "change-me", "changeme", "replace-me", "replace-this-secret", "replace-with-strong-random-string-at-least-10-chars":
		return true
	default:
		return false
	}
}

func LoadDatabaseURL() (string, error) {
	databaseURL := normalizeDatabaseURL(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return "", errors.New("DATABASE_URL 不能为空")
	}
	return databaseURL, nil
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

func getenvBoundedInt(key string, fallback int, minimum int, maximum int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s 必须是 %d 到 %d 之间的整数", key, minimum, maximum)
	}
	return parsed, nil
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
