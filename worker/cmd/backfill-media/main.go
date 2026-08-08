package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	narraw "narra-image-worker/internal/worker"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "只统计可回填的行，不写 S3 也不更新数据库")
	limit := flag.Int("limit", 0, "本次最多处理的图片/视频行数（0 = 不限制）")
	includeHTTP := flag.Bool("include-http", false, "把 http(s) 历史图片/视频也纳入回填（默认只处理 data: 前缀）")
	timeout := flag.Duration("timeout", 30*time.Minute, "回填整体超时时间")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	databaseURL, err := narraw.LoadDatabaseURL()
	if err != nil {
		logger.Error("配置读取失败", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, *timeout)
	defer cancel()

	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		logger.Error("数据库连接串解析失败", "error", err)
		os.Exit(1)
	}
	poolConfig.MaxConns = 4

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		logger.Error("数据库连接失败", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		logger.Error("数据库不可用", "error", err)
		os.Exit(1)
	}

	storage, err := narraw.NewStorage(ctx, narraw.LoadStorageConfig())
	if err != nil {
		logger.Error("存储初始化失败", "error", err)
		os.Exit(1)
	}
	if !storage.HasObjectStorage() {
		logger.Error("未配置对象存储（S3/R2），无法执行媒体回填")
		os.Exit(1)
	}

	result, err := narraw.BackfillMedia(ctx, pool, storage, narraw.BackfillOptions{
		DryRun:      *dryRun,
		Limit:       *limit,
		IncludeHTTP: *includeHTTP,
	})
	if err != nil {
		logger.Error("媒体回填失败", "error", err)
		os.Exit(1)
	}

	logger.Info(
		"媒体回填完成",
		"dry_run", result.DryRun,
		"images_scanned", result.ImagesScanned,
		"images_updated", result.ImagesUpdated,
		"videos_scanned", result.VideosScanned,
		"videos_updated", result.VideosUpdated,
		"skipped_unknown", result.SkippedNoData,
		"errors", len(result.Errors),
	)
	for _, message := range result.Errors {
		fmt.Fprintln(os.Stderr, message)
	}
}
