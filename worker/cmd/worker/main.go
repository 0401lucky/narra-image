package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	narraw "narra-image-worker/internal/worker"
)

func main() {
	logger := narraw.NewJSONLogger(os.Stdout, 0)
	if len(os.Args) > 1 {
		if len(os.Args) != 2 || os.Args[1] != "--init-image-volume" {
			logger.Error("不支持的 Worker 参数", "event", "config_invalid")
			os.Exit(1)
		}
		cfg, err := narraw.LoadStorageConfig()
		if err != nil || !cfg.ImageStorageManagedEnabled || cfg.ImageStorageBackend != "local" {
			logger.Error("初始化要求启用本地图片存储并配置卷目录和 UUID", "event", "image_volume_config_invalid")
			os.Exit(1)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := narraw.InitializeLocalImageVolume(ctx, narraw.LocalImageStoreConfig{RootDirectory: cfg.ImageStoragePath, VolumeID: cfg.ImageStorageVolumeID}); err != nil {
			logger.Error("图片卷初始化失败，目标必须是已存在的空目录", "event", "image_volume_init_failed")
			os.Exit(1)
		}
		logger.Info("图片卷已初始化", "event", "image_volume_initialized")
		return
	}

	cfg, err := narraw.LoadConfig()
	if err != nil {
		logger.Error("配置读取失败", "component", "generation_worker", "event", "config_invalid", "error", err)
		os.Exit(1)
	}
	logger = narraw.NewJSONLogger(os.Stdout, cfg.LogLevel).With(
		"component", "generation_worker",
		"runtime_mode", cfg.RuntimeMode,
		"worker_id", cfg.WorkerID,
	)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		logger.Error("数据库连接串解析失败", "event", "database_url_invalid", "error", err)
		os.Exit(1)
	}
	poolConfig.MaxConns = int32(cfg.Concurrency + 2)

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		logger.Error("数据库连接池创建失败", "event", "database_pool_failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	worker := narraw.New(pool, cfg, logger)
	if err := worker.Run(ctx); err != nil {
		logger.Error("Worker 异常退出", "event", "worker_exit_failed", "error", err)
		os.Exit(1)
	}
	logger.Info("Worker 已停止", "event", "worker_stopped")
}
