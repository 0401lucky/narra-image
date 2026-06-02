package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	narraw "narra-image-worker/internal/worker"
)

func main() {
	source := flag.String("source", "all", "要同步的提示词来源 slug/id，默认 all")
	timeout := flag.Duration("timeout", 10*time.Minute, "同步超时时间")
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

	syncer := narraw.NewPromptSyncer(pool, logger)
	if *source == "all" {
		results, err := syncer.SyncAll(ctx)
		if err != nil {
			logger.Error("提示词同步失败", "error", err)
			os.Exit(1)
		}
		logger.Info("提示词同步完成", "sources", len(results))
		return
	}

	result, err := syncer.SyncSource(ctx, *source)
	if err != nil {
		logger.Error("提示词同步失败", "source", *source, "error", err)
		os.Exit(1)
	}
	logger.Info("提示词同步完成", "source", result.Slug, "count", result.Count)
}
