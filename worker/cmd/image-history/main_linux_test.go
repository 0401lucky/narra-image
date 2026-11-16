//go:build linux

package main

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"syscall"
	"testing"
)

// Directory snapshots would miss a create/delete probe. The Linux topology
// runner records actual filesystem mutations from command initialization until
// exit, including transient staging/probe/marker events.
func TestImageHistoryDefaultCommandHasNoPhysicalMutations(t *testing.T) {
	deps, manifest, rootPath, counts := historyCommandFixture(t)
	watch, err := syscall.InotifyInit1(syscall.IN_CLOEXEC | syscall.IN_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(watch)
	mask := uint32(syscall.IN_CREATE | syscall.IN_DELETE | syscall.IN_MOVED_FROM | syscall.IN_MOVED_TO | syscall.IN_CLOSE_WRITE | syscall.IN_ATTRIB)
	// Inotify watches one directory at a time. Watch every existing directory
	// so an existing source/staging subdirectory cannot hide a transient write.
	// Creating a new directory is itself a forbidden event on its parent.
	if err := filepath.WalkDir(rootPath, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() {
			return nil
		}
		_, err := syscall.InotifyAddWatch(watch, path, mask)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	exitCode := runImageHistoryCommand(context.Background(), []string{"--bindings", "-", "--target-location", "local-v1:" + historyCommandVolumeID}, bytes.NewReader(manifest), &output, deps)
	if exitCode != 0 {
		t.Fatalf("readonly command failed: %s", output.String())
	}
	events := make([]byte, 16*1024)
	n, readErr := syscall.Read(watch, events)
	if n > 0 || (readErr != nil && !errors.Is(readErr, syscall.EAGAIN)) || counts.writerSessions != 0 || counts.writerFactories != 0 {
		t.Fatalf("default initialization/plan mutated storage: events=%d counts=%+v error=%v", n, counts, readErr)
	}
}
