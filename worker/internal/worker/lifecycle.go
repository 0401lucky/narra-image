package worker

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	errorChannelNotFound            = "CHANNEL_NOT_FOUND"
	errorChannelInactive            = "CHANNEL_INACTIVE"
	errorChannelSecretDecryptFailed = "CHANNEL_SECRET_DECRYPT_FAILED"
	errorModelNotSupported           = "MODEL_NOT_SUPPORTED_BY_CHANNEL"
	errorProviderNotConfigured       = "PROVIDER_NOT_CONFIGURED"
	errorProviderConnectionFailed   = "PROVIDER_CONNECTION_FAILED"
	errorProviderRateLimited         = "PROVIDER_RATE_LIMITED"
	errorProviderUnavailable         = "PROVIDER_UNAVAILABLE"
	errorProviderAuthFailed          = "PROVIDER_AUTH_FAILED"
	errorProviderRequestInvalid      = "PROVIDER_REQUEST_INVALID"
	errorProviderPolicyRejected      = "PROVIDER_POLICY_REJECTED"
	errorSourceImageInvalid          = "SOURCE_IMAGE_INVALID"
	errorGenerationCancelled        = "GENERATION_CANCELLED"
	errorMaxAttemptsExhausted        = "MAX_ATTEMPTS_EXHAUSTED"
	errorLeaseLostBeforeHandoff      = "LEASE_LOST_BEFORE_HANDOFF"
	errorHandoffUnknown              = "HANDOFF_UNKNOWN"
	errorResultPersistFailed         = "RESULT_PERSIST_FAILED"
)

type ContractFailure struct {
	Code                string
	Message             string
	Retryable           bool
	HandoffUnknown      bool
	ResolvedAfterSubmit bool
}

func (failure ContractFailure) Error() string {
	if strings.TrimSpace(failure.Message) != "" {
		return failure.Message
	}
	return failure.Code
}

type ProviderHTTPError struct {
	NotSubmitted bool
	StatusCode   int
	Summary      string
}

func (failure ProviderHTTPError) Error() string {
	return fmt.Sprintf("渠道请求失败：HTTP %d %s", failure.StatusCode, failure.Summary)
}

type ResultPersistError struct {
	Cause error
}

func (failure ResultPersistError) Error() string {
	return fmt.Sprintf("生成结果写回存储失败：%v", failure.Cause)
}

func (failure ResultPersistError) Unwrap() error {
	return failure.Cause
}

type providerLifecycleContextKey struct{}

type providerLifecycleHooks struct {
	markSubmitting func(context.Context) error
	markSubmitted  func(context.Context, string) error
	recordRequestID func(context.Context, string) error

	submittingErr  error
	submittingOnce sync.Once
	submittedErr   error
	submittedOnce  sync.Once
}

func withProviderLifecycle(
	ctx context.Context,
	markSubmitting func(context.Context) error,
	markSubmitted func(context.Context, string) error,
	recordRequestID func(context.Context, string) error,
) context.Context {
	hooks := &providerLifecycleHooks{
		markSubmitting: markSubmitting,
		markSubmitted:  markSubmitted,
		recordRequestID: recordRequestID,
	}
	return context.WithValue(ctx, providerLifecycleContextKey{}, hooks)
}

func providerLifecycleFromContext(ctx context.Context) *providerLifecycleHooks {
	hooks, _ := ctx.Value(providerLifecycleContextKey{}).(*providerLifecycleHooks)
	return hooks
}

func markProviderSubmitting(ctx context.Context) error {
	hooks := providerLifecycleFromContext(ctx)
	if hooks == nil || hooks.markSubmitting == nil {
		return nil
	}
	hooks.submittingOnce.Do(func() {
		hooks.submittingErr = hooks.markSubmitting(ctx)
	})
	return hooks.submittingErr
}

func markProviderSubmitted(ctx context.Context, requestID string) error {
	hooks := providerLifecycleFromContext(ctx)
	if hooks == nil || hooks.markSubmitted == nil {
		return nil
	}
	hooks.submittedOnce.Do(func() {
		hooks.submittedErr = hooks.markSubmitted(ctx, requestID)
	})
	return hooks.submittedErr
}

func recordProviderRequestID(ctx context.Context, requestID string) error {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil
	}
	hooks := providerLifecycleFromContext(ctx)
	if hooks == nil || hooks.recordRequestID == nil {
		return nil
	}
	return hooks.recordRequestID(ctx, requestID)
}

func providerRequestIDFromHeader(header http.Header) string {
	for _, key := range []string{
		"x-request-id",
		"request-id",
		"openai-request-id",
		"x-provider-request-id",
	} {
		if value := strings.TrimSpace(header.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func providerExplicitlyRejected(header http.Header) bool {
	value := strings.ToLower(strings.TrimSpace(header.Get("x-narra-not-submitted")))
	return value == "true" || value == "1" || value == "yes"
}

func classifyProviderFailure(err error) ContractFailure {
	if err == nil {
		return ContractFailure{}
	}
	var contractFailure ContractFailure
	if errors.As(err, &contractFailure) {
		return contractFailure
	}
	var persistFailure ResultPersistError
	if errors.As(err, &persistFailure) {
		return ContractFailure{
			Code: errorResultPersistFailed, Message: persistFailure.Error(), HandoffUnknown: true,
		}
	}
	var httpFailure ProviderHTTPError
	if errors.As(err, &httpFailure) {
		switch {
		case httpFailure.StatusCode == http.StatusTooManyRequests:
			return ContractFailure{Code: errorProviderRateLimited, Message: httpFailure.Error(), Retryable: true}
		case httpFailure.StatusCode >= 500 && httpFailure.NotSubmitted:
			return ContractFailure{Code: errorProviderUnavailable, Message: httpFailure.Error(), Retryable: true}
		case httpFailure.StatusCode >= 500:
			return ContractFailure{Code: errorHandoffUnknown, Message: httpFailure.Error(), HandoffUnknown: true}
		case httpFailure.StatusCode == http.StatusUnauthorized || httpFailure.StatusCode == http.StatusForbidden:
			return ContractFailure{Code: errorProviderAuthFailed, Message: httpFailure.Error()}
		case httpFailure.StatusCode == http.StatusBadRequest || httpFailure.StatusCode == http.StatusUnprocessableEntity:
			return ContractFailure{Code: errorProviderRequestInvalid, Message: httpFailure.Error()}
		default:
			return ContractFailure{Code: errorProviderPolicyRejected, Message: httpFailure.Error()}
		}
	}
	var urlFailure *url.Error
	if errors.As(err, &urlFailure) {
		var networkFailure *net.OpError
		if errors.As(urlFailure.Err, &networkFailure) && networkFailure.Op == "dial" {
			return ContractFailure{
				Code: errorProviderConnectionFailed, Message: err.Error(), Retryable: true,
			}
		}
		return ContractFailure{Code: errorHandoffUnknown, Message: err.Error(), HandoffUnknown: true}
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ContractFailure{Code: errorHandoffUnknown, Message: err.Error(), HandoffUnknown: true}
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "参考图") ||
		strings.Contains(message, "有效图片") ||
		strings.Contains(message, "50mb") ||
		strings.Contains(message, "内网") ||
		strings.Contains(message, "非公网") {
		return ContractFailure{Code: errorSourceImageInvalid, Message: err.Error()}
	}
	// 请求已经进入 SUBMITTING 后，无法证明的解析/连接错误一律保守进入 UNKNOWN。
	return ContractFailure{Code: errorHandoffUnknown, Message: err.Error(), HandoffUnknown: true}
}

func retryDelay(base time.Duration, ordinal int) time.Duration {
	if base <= 0 {
		base = time.Second
	}
	if ordinal < 1 {
		ordinal = 1
	}
	delay := base
	for attempt := 1; attempt < ordinal && delay < 5*time.Minute; attempt++ {
		delay *= 2
	}
	if delay > 5*time.Minute {
		return 5 * time.Minute
	}
	return delay
}

func handoffAllowsRefund(contractVersion int, handoffState string) bool {
	if contractVersion < 1 {
		return true
	}
	switch handoffState {
	case "NOT_STARTED", "RESOLVED":
		return true
	default:
		return false
	}
}

func detachedFinalizationContext(parent context.Context, grace time.Duration) (context.Context, context.CancelFunc) {
	if grace <= 0 {
		grace = 10 * time.Second
	}
	if grace > 30*time.Second {
		grace = 30 * time.Second
	}
	return context.WithTimeout(context.WithoutCancel(parent), grace)
}
