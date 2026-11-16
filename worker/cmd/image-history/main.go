package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	narraw "narra-image-worker/internal/worker"
)

type historyCommandSession struct {
	reader narraw.ImageHistoryReadRepository
	writer narraw.ImageHistoryApplyRepository
	verify func(context.Context) error
	close  func()
}

type historyCommandDeps struct {
	loadURL      func() (string, error)
	loadStorage  func() (narraw.Config, error)
	open         func(context.Context, string, bool) (historyCommandSession, error)
	openManifest func(string) (io.ReadCloser, error)
	newInspector func(narraw.Config, []narraw.ImageLocationInput) (narraw.ImageHistoryReadOnlyIO, error)
	newWriter    func(narraw.Config, []narraw.ImageLocationInput) (narraw.ImageHistoryApplyIO, error)
}

type historyCommandResult struct {
	SchemaVersion int                             `json:"schemaVersion"`
	DryRun        bool                            `json:"dryRun"`
	Code          string                          `json:"code"`
	Status        string                          `json:"status"`
	Plan          *narraw.ImageHistoryPlan        `json:"plan,omitempty"`
	Progress      *narraw.ImageHistoryApplyReport `json:"progress,omitempty"`
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(runImageHistoryCommand(ctx, os.Args[1:], os.Stdin, os.Stdout, defaultHistoryCommandDeps()))
}

func defaultHistoryCommandDeps() historyCommandDeps {
	return historyCommandDeps{
		loadURL: narraw.LoadDatabaseURL, loadStorage: narraw.LoadStorageConfig,
		openManifest: func(path string) (io.ReadCloser, error) { return os.Open(path) },
		newInspector: func(cfg narraw.Config, locations []narraw.ImageLocationInput) (narraw.ImageHistoryReadOnlyIO, error) {
			return narraw.NewImageHistoryInspector(cfg, locations)
		},
		newWriter: func(cfg narraw.Config, locations []narraw.ImageLocationInput) (narraw.ImageHistoryApplyIO, error) {
			return narraw.NewImageHistoryWriter(cfg, locations)
		},
		open: openHistoryCommandSession,
	}
}

func openHistoryCommandSession(ctx context.Context, databaseURL string, apply bool) (historyCommandSession, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return historyCommandSession{}, narraw.ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	cfg.MaxConns = 2
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	if !apply {
		// Read-only is enforced from connection initialization as well as on
		// the snapshot transaction. Accidental SQL mutation fails at the DB.
		cfg.ConnConfig.RuntimeParams["default_transaction_read_only"] = "on"
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return historyCommandSession{}, narraw.ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	if apply {
		repository := narraw.NewImageRepository(pool)
		return historyCommandSession{reader: repository, writer: repository, verify: repository.VerifySchema, close: pool.Close}, nil
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		pool.Close()
		return historyCommandSession{}, narraw.ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	repository := narraw.NewImageRepository(tx)
	return historyCommandSession{reader: repository, verify: repository.VerifySchema, close: func() {
		closeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(closeCtx)
		pool.Close()
	}}, nil
}

func runImageHistoryCommand(parent context.Context, arguments []string, input io.Reader, output io.Writer, deps historyCommandDeps) int {
	flags := flag.NewFlagSet("image-history", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	apply := flags.Bool("apply", false, "执行已显式绑定来源的持久登记/复制；默认只读")
	dryRun := flags.Bool("dry-run", true, "只读盘点，不登记位置、不写探针或对象")
	manifestPath := flags.String("bindings", "", "严格 JSON 来源清单路径；- 从 stdin 读取，最多 1 MiB")
	scope := flags.String("scope", "ALL", "ALL | GENERATED | CANVAS_IMPORT | REFERENCE_URL")
	limit := flags.Int("limit", narraw.ImageHistoryPageSize, "本次最多盘点/领取项数（1..1000）")
	cursor := flags.String("cursor", "", "只读扫描/任务项列表返回的不透明下一页游标")
	upperBound := flags.String("upper-bound", "", "只读扫描返回的固定上界；省略时由数据库确定")
	target := flags.String("target-location", "", "清单中的目标 locationId；省略时只登记历史源")
	requestID := flags.String("request-id", "", "apply 新任务所需的幂等 UUID")
	actorID := flags.String("actor-id", "", "新任务的审计执行者身份")
	jobID := flags.String("job-id", "", "读取或恢复同一个持久任务；不会重新扫描/改变已冻结意图")
	itemID := flags.String("item-id", "", "apply 时显式恢复该任务中某个被阻塞的 item UUID")
	retire := flags.Bool("retire-source", false, "显式要求复制校验后排入既有 SOURCE_RETIREMENT 执行器")
	timeout := flags.Duration("timeout", 30*time.Minute, "本次命令总期限（1s..24h），每个对象 IO 仍最多 30s")
	flags.Usage = func() {
		_, _ = fmt.Fprintln(output, "image-history defaults to a read-only, bounded inventory. Explicit --apply is required for mutations.")
		flags.SetOutput(output)
		flags.PrintDefaults()
		flags.SetOutput(io.Discard)
	}
	err := flags.Parse(arguments)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	write := func(result historyCommandResult, exitCode int) int {
		if json.NewEncoder(output).Encode(result) != nil {
			return 1
		}
		return exitCode
	}
	failure := func(code string, progress *narraw.ImageHistoryApplyReport) int {
		return write(historyCommandResult{SchemaVersion: 1, DryRun: !*apply, Code: code, Status: "error", Progress: progress}, 1)
	}
	dryRunExplicit := false
	flags.Visit(func(value *flag.Flag) {
		if value.Name == "dry-run" {
			dryRunExplicit = true
		}
	})
	if err != nil || flags.NArg() != 0 || *limit < 1 || *limit > narraw.ImageHistoryMaxItems || *timeout < time.Second || *timeout > 24*time.Hour ||
		(*apply && dryRunExplicit && *dryRun) || (!*apply && !*dryRun) || (*retire && !*apply) || (*apply && *cursor != "") ||
		(*itemID != "" && (!*apply || *jobID == "")) || (*jobID != "" && *requestID != "") {
		return failure("IMAGE_INVALID_INPUT", nil)
	}
	ctx, cancel := context.WithTimeout(parent, *timeout)
	defer cancel()
	manifest := narraw.ImageHistoryManifest{SchemaVersion: 1, Locations: []narraw.ImageLocationInput{}, Bindings: []narraw.ImageHistorySourceBinding{}}
	if *manifestPath != "" {
		manifestReader := input
		var file io.ReadCloser
		if *manifestPath != "-" {
			file, err = deps.openManifest(*manifestPath)
			if err != nil {
				return failure("IMAGE_HISTORY_MANIFEST_UNAVAILABLE", nil)
			}
			defer file.Close()
			manifestReader = file
		}
		manifest, err = decodeHistoryCommandManifest(ctx, manifestReader)
		if err != nil {
			if ctx.Err() != nil {
				return failure(narraw.ImageHistoryErrorCode(ctx.Err()), nil)
			}
			return failure("IMAGE_INVALID_INPUT", nil)
		}
	}
	if ctx.Err() != nil {
		return failure(narraw.ImageHistoryErrorCode(ctx.Err()), nil)
	}
	databaseURL, err := deps.loadURL()
	if err != nil {
		return failure("IMAGE_HISTORY_CONFIG_INVALID", nil)
	}
	session, err := deps.open(ctx, databaseURL, *apply)
	if err != nil {
		return failure("IMAGE_HISTORY_DATABASE_UNAVAILABLE", nil)
	}
	defer session.close()
	if err := session.verify(ctx); err != nil {
		return failure("IMAGE_HISTORY_SCHEMA_UNAVAILABLE", nil)
	}
	if *jobID != "" && !*apply {
		progress, err := narraw.ReadImageHistoryProgress(ctx, session.reader, *jobID, *cursor, *limit)
		if err != nil {
			return failure(narraw.ImageHistoryErrorCode(err), nil)
		}
		return write(historyCommandResult{SchemaVersion: 1, DryRun: true, Code: "IMAGE_HISTORY_PROGRESS", Status: "read", Progress: &progress}, 0)
	}
	var storageConfig narraw.Config
	if len(manifest.Locations) > 0 {
		storageConfig, err = deps.loadStorage()
		if err != nil {
			return failure("IMAGE_HISTORY_CONFIG_INVALID", nil)
		}
	}
	planOptions := narraw.ImageHistoryPlanOptions{Scope: *scope, Cursor: *cursor, UpperBound: *upperBound, Limit: *limit, TargetLocationID: *target, RetireSource: *retire, PublicURLBase: storageConfig.AppURL}
	if *jobID != "" {
		planOptions.PublicURLBase = "" // Resume uses the job's immutable publication base.
	}
	if !*apply {
		inspector, err := deps.newInspector(storageConfig, manifest.Locations)
		if err != nil {
			return failure(narraw.ImageHistoryErrorCode(err), nil)
		}
		plan, err := narraw.BuildImageHistoryPlan(ctx, session.reader, inspector, manifest, planOptions)
		if err != nil {
			return failure(narraw.ImageHistoryErrorCode(err), nil)
		}
		return write(historyCommandResult{SchemaVersion: 1, DryRun: true, Code: "IMAGE_HISTORY_PLANNED", Status: "planned", Plan: &plan}, 0)
	}
	if *jobID == "" {
		if err := narraw.ValidateImageHistoryApplyConfig(storageConfig); err != nil {
			return failure("IMAGE_HISTORY_CONFIG_INVALID", nil)
		}
	}
	writer, err := deps.newWriter(storageConfig, manifest.Locations)
	if err != nil {
		return failure(narraw.ImageHistoryErrorCode(err), nil)
	}
	progress, err := narraw.ApplyImageHistory(ctx, session.writer, writer, manifest, narraw.ImageHistoryApplyOptions{ImageHistoryPlanOptions: planOptions,
		RequestID: *requestID, ActorID: *actorID, JobID: *jobID, ItemID: *itemID})
	if err != nil {
		return failure(narraw.ImageHistoryErrorCode(err), &progress)
	}
	result := historyCommandResult{SchemaVersion: 1, Code: "IMAGE_HISTORY_APPLIED", Status: "applied", Progress: &progress}
	if progress.Blocked > 0 || progress.HasMore {
		result.Code, result.Status = "IMAGE_HISTORY_PENDING", "pending"
		return write(result, 2)
	}
	return write(result, 0)
}

func decodeHistoryCommandManifest(ctx context.Context, reader io.Reader) (narraw.ImageHistoryManifest, error) {
	if ctx.Err() != nil {
		return narraw.ImageHistoryManifest{}, ctx.Err()
	}
	// stdin can be a pipe whose producer never closes it. Cancelling the
	// command must interrupt that read before any database/storage dependency.
	if closer, ok := reader.(io.Closer); ok {
		stop := context.AfterFunc(ctx, func() { _ = closer.Close() })
		defer stop()
	}
	manifest, err := narraw.DecodeImageHistoryManifest(reader)
	if ctx.Err() != nil {
		return narraw.ImageHistoryManifest{}, ctx.Err()
	}
	return manifest, err
}
