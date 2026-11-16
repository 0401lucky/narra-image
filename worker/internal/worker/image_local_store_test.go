package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const localImageTestVolumeID = "37bea8ac-809f-4298-92d8-a3597a8437c6"

func localImageFixture(t *testing.T) (*LocalImageStore, LocalImageStoreConfig) {
	t.Helper()
	config := LocalImageStoreConfig{RootDirectory: t.TempDir(), VolumeID: localImageTestVolumeID}
	if _, err := InitializeLocalImageVolume(context.Background(), config); err != nil {
		t.Fatal(err)
	}
	store, err := NewLocalImageStore(config)
	if err != nil {
		t.Fatal(err)
	}
	return store, config
}

func localImageInput(data []byte) LocalImagePutInput {
	digest := sha256.Sum256(data)
	return LocalImagePutInput{LocalImageObject: LocalImageObject{
		Key: "images/fixture.png", ByteLength: int64(len(data)), SHA256: hex.EncodeToString(digest[:]),
	}, Bytes: data}
}

func assertLocalImageError(t *testing.T, err error, code string) {
	t.Helper()
	var local *LocalImageStoreError
	if !errors.As(err, &local) || local.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func assertLocalImageFiles(t *testing.T, root string, wantCount int) {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != wantCount {
		t.Fatalf("want %d files, got %v", wantCount, entries)
	}
}

type localImageLookupHookRoot struct {
	*os.Root
	afterLstat func(string, os.FileInfo, error)
}

func (root localImageLookupHookRoot) Lstat(name string) (os.FileInfo, error) {
	info, err := root.Root.Lstat(name)
	root.afterLstat(name, info, err)
	return info, err
}

func TestLocalImageVolumeExplicitInitializationAndReopen(t *testing.T) {
	ctx := context.Background()
	config := LocalImageStoreConfig{RootDirectory: t.TempDir(), VolumeID: localImageTestVolumeID}
	store, err := NewLocalImageStore(config)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Verify(ctx)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_UNAVAILABLE")
	assertLocalImageFiles(t, config.RootDirectory, 0)
	for range 2 {
		volume, err := InitializeLocalImageVolume(ctx, config)
		if err != nil || volume.LocationID != "local-v1:"+localImageTestVolumeID {
			t.Fatalf("volume=%+v error=%v", volume, err)
		}
	}
	marker, err := os.ReadFile(filepath.Join(config.RootDirectory, LocalImageVolumeMarker))
	if err != nil || string(marker) != "narra-image-volume-v1\n"+localImageTestVolumeID+"\n" {
		t.Fatalf("unexpected cross-language marker: %q (%v)", marker, err)
	}
	if _, err := store.Verify(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ProbeWritable(ctx); err != nil {
		t.Fatal(err)
	}
	assertLocalImageFiles(t, config.RootDirectory, 1)
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	_, err = store.ProbeWritable(cancelled)
	assertLocalImageError(t, err, "LOCAL_IMAGE_ABORTED")
	assertLocalImageFiles(t, config.RootDirectory, 1)
}

func TestLocalImageVolumeRejectsUnownedAndInvalidRoots(t *testing.T) {
	ctx := context.Background()
	parent := t.TempDir()
	missing := LocalImageStoreConfig{RootDirectory: filepath.Join(parent, "missing"), VolumeID: localImageTestVolumeID}
	_, err := InitializeLocalImageVolume(ctx, missing)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_UNAVAILABLE")
	assertLocalImageFiles(t, parent, 0)
	if err := os.WriteFile(filepath.Join(parent, "retain.txt"), []byte("retain"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = InitializeLocalImageVolume(ctx, LocalImageStoreConfig{RootDirectory: parent, VolumeID: localImageTestVolumeID})
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_UNAVAILABLE")
	assertLocalImageFiles(t, parent, 1)

	store, config := localImageFixture(t)
	wrong := config
	wrong.VolumeID = "067c5381-8097-4805-9b82-fea604ba54e4"
	_, err = InitializeLocalImageVolume(ctx, wrong)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_MISMATCH")
	if err := os.WriteFile(filepath.Join(config.RootDirectory, LocalImageVolumeMarker), bytes.Repeat([]byte{0}, 2000), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = store.Verify(ctx)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_MISMATCH")
	for _, invalid := range []LocalImageStoreConfig{
		{RootDirectory: "relative", VolumeID: localImageTestVolumeID},
		{RootDirectory: filepath.VolumeName(parent) + string(os.PathSeparator), VolumeID: localImageTestVolumeID},
		{RootDirectory: parent, VolumeID: strings.ToUpper(localImageTestVolumeID)},
		{RootDirectory: parent, VolumeID: localImageTestVolumeID + "\n"},
		{RootDirectory: parent, VolumeID: localImageTestVolumeID + "\r"},
		{RootDirectory: parent, VolumeID: localImageTestVolumeID + "\u2028"},
		{RootDirectory: parent, VolumeID: localImageTestVolumeID + "\u2029"},
	} {
		_, err := NewLocalImageStore(invalid)
		assertLocalImageError(t, err, "LOCAL_IMAGE_INVALID_CONFIG")
	}
}

func TestLocalImageVolumeRejectsSymlinks(t *testing.T) {
	_, config := localImageFixture(t)
	parent := t.TempDir()
	linkedRoot := filepath.Join(parent, "linked-root")
	if err := os.Symlink(config.RootDirectory, linkedRoot); err != nil {
		t.Fatal(err)
	}
	store, err := NewLocalImageStore(LocalImageStoreConfig{RootDirectory: linkedRoot, VolumeID: config.VolumeID})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Verify(context.Background())
	assertLocalImageError(t, err, "LOCAL_IMAGE_UNSAFE_PATH")
	markerRoot := t.TempDir()
	if err := os.Symlink(filepath.Join(config.RootDirectory, LocalImageVolumeMarker), filepath.Join(markerRoot, LocalImageVolumeMarker)); err != nil {
		t.Fatal(err)
	}
	_, err = InitializeLocalImageVolume(context.Background(), LocalImageStoreConfig{RootDirectory: markerRoot, VolumeID: config.VolumeID})
	assertLocalImageError(t, err, "LOCAL_IMAGE_UNSAFE_PATH")
}

func TestLocalImageObjectNamesAndInvalidKeys(t *testing.T) {
	object, staging, err := LocalImageObjectNames("images/fixture.png")
	if err != nil || object != "image-089786809928b8b7a61687ac77f01d228919756aafeefe9157e3e6bbaef315ef.bin" ||
		staging != ".image-089786809928b8b7a61687ac77f01d228919756aafeefe9157e3e6bbaef315ef.writing" {
		t.Fatalf("unexpected cross-language names: %q %q %v", object, staging, err)
	}
	for _, key := range []string{
		"a/" + strings.Repeat("b", 128),
		strings.Join([]string{strings.Repeat("a", 128), strings.Repeat("b", 128), strings.Repeat("c", 128), strings.Repeat("d", 125)}, "/"),
	} {
		if _, _, err := LocalImageObjectNames(key); err != nil {
			t.Fatalf("valid key at inclusive length limit was rejected: %v", err)
		}
	}
	for _, key := range []string{"", "../outside", "/absolute", "a/../b", "a/./b", "a//b", `a\b`, "C:drive", "a/%2e%2e", "a/中文", "a/", "a/" + strings.Repeat("b", 129), strings.Repeat("a/", 256) + "b"} {
		_, _, err := LocalImageObjectNames(key)
		assertLocalImageError(t, err, "LOCAL_IMAGE_INVALID_OBJECT")
	}
	for _, ending := range []string{"\n", "\r", "\u2028", "\u2029"} {
		for _, key := range []string{"images/fixture.png" + ending, "images" + ending + "/fixture.png"} {
			_, _, err := LocalImageObjectNames(key)
			assertLocalImageError(t, err, "LOCAL_IMAGE_INVALID_OBJECT")
		}
	}
}

func TestLocalImageStorePersistentImmutableRoundtripAndDelete(t *testing.T) {
	ctx := context.Background()
	store, config := localImageFixture(t)
	input := localImageInput([]byte("image-storage-fixture"))
	result, err := store.Put(ctx, input)
	if err != nil || result.ByteLength != input.ByteLength || result.SHA256 != input.SHA256 {
		t.Fatalf("put: %+v %v", result, err)
	}
	reopened, err := NewLocalImageStore(config)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := reopened.Read(ctx, input.LocalImageObject)
	if err != nil || !bytes.Equal(actual, input.Bytes) {
		t.Fatalf("read: %q %v", actual, err)
	}
	if head, err := reopened.Head(ctx, input.LocalImageObject); err != nil || head != result {
		t.Fatalf("head: %+v %v", head, err)
	}
	_, err = store.Put(ctx, localImageInput([]byte("a different image")))
	assertLocalImageError(t, err, "LOCAL_IMAGE_OBJECT_EXISTS")
	assertLocalImageFiles(t, config.RootDirectory, 2)
	if outcome, err := reopened.Delete(ctx, input.LocalImageObject); err != nil || outcome != LocalImageDeleted {
		t.Fatalf("delete: %s %v", outcome, err)
	}
	if outcome, err := reopened.Delete(ctx, input.LocalImageObject); err != nil || outcome != LocalImageMissing {
		t.Fatalf("repeat delete: %s %v", outcome, err)
	}
	assertLocalImageFiles(t, config.RootDirectory, 1)
}

func TestLocalImageStoreRejectsIdentityAndBoundsBeforeWrite(t *testing.T) {
	store, config := localImageFixture(t)
	input := localImageInput([]byte("image-storage-fixture"))
	wrong := input
	wrong.SHA256 = strings.Repeat("0", 64)
	_, err := store.Put(context.Background(), wrong)
	assertLocalImageError(t, err, "LOCAL_IMAGE_CONTENT_MISMATCH")
	wrong = input
	wrong.ByteLength++
	_, err = store.Put(context.Background(), wrong)
	assertLocalImageError(t, err, "LOCAL_IMAGE_CONTENT_MISMATCH")
	for _, size := range []int64{0, -1, ImageMaxBytes + 1} {
		wrong = input
		wrong.ByteLength = size
		_, err = store.Put(context.Background(), wrong)
		assertLocalImageError(t, err, "LOCAL_IMAGE_INVALID_OBJECT")
	}
	for _, ending := range []string{"\n", "\r", "\u2028", "\u2029"} {
		wrong := input.LocalImageObject
		wrong.SHA256 += ending
		_, err := store.Head(context.Background(), wrong)
		assertLocalImageError(t, err, "LOCAL_IMAGE_INVALID_OBJECT")
	}
	assertLocalImageFiles(t, config.RootDirectory, 1)
}

func TestLocalImageStorePendingWriteIsNotMissing(t *testing.T) {
	ctx := context.Background()
	store, config := localImageFixture(t)
	input := localImageInput([]byte("image-storage-fixture"))
	_, stage, _ := LocalImageObjectNames(input.Key)
	stagePath := filepath.Join(config.RootDirectory, stage)
	if err := os.WriteFile(stagePath, input.Bytes[:4], 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := store.Put(ctx, input)
	assertLocalImageError(t, err, "LOCAL_IMAGE_WRITE_PENDING")
	_, err = store.Read(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_WRITE_PENDING")
	_, err = store.Head(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_WRITE_PENDING")
	_, err = store.Delete(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_WRITE_PENDING")
	if _, err := InitializeLocalImageVolume(ctx, config); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(stagePath)
	if err != nil || !bytes.Equal(actual, input.Bytes[:4]) {
		t.Fatalf("pending write changed: %q %v", actual, err)
	}
}

func TestLocalImageObjectLookupRechecksConcurrentStage(t *testing.T) {
	for _, existing := range []bool{false, true} {
		name := "missing final object"
		if existing {
			name = "opened final object"
		}
		t.Run(name, func(t *testing.T) {
			store, config := localImageFixture(t)
			input := localImageInput([]byte("image-storage-fixture"))
			if existing {
				if _, err := store.Put(context.Background(), input); err != nil {
					t.Fatal(err)
				}
			}
			object, stage, err := LocalImageObjectNames(input.Key)
			if err != nil {
				t.Fatal(err)
			}
			root, err := os.OpenRoot(config.RootDirectory)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			stagePath := filepath.Join(config.RootDirectory, stage)
			objectLookups := 0
			hooked := localImageLookupHookRoot{Root: root, afterLstat: func(name string, _ os.FileInfo, lookupErr error) {
				if name != object {
					return
				}
				objectLookups++
				// Create a real pending write just after the absent lookup, or
				// the identity check on an already opened final object.
				if errors.Is(lookupErr, os.ErrNotExist) || (existing && objectLookups == 2) {
					if err := os.WriteFile(stagePath, input.Bytes[:4], 0o600); err != nil {
						t.Fatal(err)
					}
				}
			}}
			file, _, err := store.openObject(context.Background(), hooked, object, stage, input.LocalImageObject)
			if file != nil {
				file.Close()
			}
			assertLocalImageError(t, err, "LOCAL_IMAGE_WRITE_PENDING")
			pending, err := os.ReadFile(stagePath)
			if err != nil || !bytes.Equal(pending, input.Bytes[:4]) {
				t.Fatalf("pending write changed: %q %v", pending, err)
			}
		})
	}
}

func TestLocalImageStoreSymlinkAndCorruptObjectAreNotDeleted(t *testing.T) {
	ctx := context.Background()
	store, config := localImageFixture(t)
	input := localImageInput([]byte("image-storage-fixture"))
	object, _, _ := LocalImageObjectNames(input.Key)
	objectPath := filepath.Join(config.RootDirectory, object)
	external := filepath.Join(t.TempDir(), "retain.bin")
	if err := os.WriteFile(external, input.Bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, objectPath); err != nil {
		t.Fatal(err)
	}
	_, err := store.Read(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_UNSAFE_PATH")
	_, err = store.Delete(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_UNSAFE_PATH")
	if err := os.Remove(objectPath); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(ctx, input); err != nil {
		t.Fatal(err)
	}
	damaged := bytes.Repeat([]byte{42}, len(input.Bytes))
	if err := os.WriteFile(objectPath, damaged, 0o600); err != nil {
		t.Fatal(err)
	}
	reader, err := store.Open(ctx, input.LocalImageObject)
	if err != nil {
		t.Fatal(err)
	}
	emitted, streamErr := reader.Read(make([]byte, len(input.Bytes)))
	assertLocalImageError(t, streamErr, "LOCAL_IMAGE_CONTENT_MISMATCH")
	if emitted >= len(input.Bytes) {
		t.Fatal("corrupt stream produced a complete-looking response")
	}
	reader.Close()
	_, err = store.Read(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_CONTENT_MISMATCH")
	_, err = store.Delete(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_CONTENT_MISMATCH")
	actual, err := os.ReadFile(objectPath)
	if err != nil || !bytes.Equal(actual, damaged) {
		t.Fatal("corrupt object was changed or deleted")
	}
	retained, err := os.ReadFile(external)
	if err != nil || !bytes.Equal(retained, input.Bytes) {
		t.Fatal("symlink target was changed")
	}
}

func TestLocalImageStoreRechecksVolumeForEveryOperation(t *testing.T) {
	ctx := context.Background()
	store, config := localImageFixture(t)
	input := localImageInput([]byte("image-storage-fixture"))
	if _, err := store.Put(ctx, input); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(config.RootDirectory, LocalImageVolumeMarker), []byte("narra-image-volume-v1\n067c5381-8097-4805-9b82-fea604ba54e4\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := store.Put(ctx, input)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_MISMATCH")
	_, err = store.Read(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_MISMATCH")
	_, err = store.Head(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_MISMATCH")
	_, err = store.Delete(ctx, input.LocalImageObject)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_MISMATCH")
	_, err = store.ProbeWritable(ctx)
	assertLocalImageError(t, err, "LOCAL_IMAGE_VOLUME_MISMATCH")
}

func TestLocalImageStoreConcurrentPublication(t *testing.T) {
	store, config := localImageFixture(t)
	candidates := []LocalImagePutInput{localImageInput(bytes.Repeat([]byte{1}, 256*1024)), localImageInput(bytes.Repeat([]byte{2}, 256*1024))}
	results := make([]error, len(candidates))
	var group sync.WaitGroup
	for index, input := range candidates {
		group.Add(1)
		go func(index int, input LocalImagePutInput) {
			defer group.Done()
			_, results[index] = store.Put(context.Background(), input)
		}(index, input)
	}
	group.Wait()
	winner := -1
	for index, err := range results {
		if err == nil {
			if winner != -1 {
				t.Fatal("multiple writers published the same key")
			}
			winner = index
		}
	}
	if winner == -1 {
		t.Fatalf("no publication succeeded: %v", results)
	}
	actual, err := store.Read(context.Background(), candidates[winner].LocalImageObject)
	if err != nil || !bytes.Equal(actual, candidates[winner].Bytes) {
		t.Fatalf("winner bytes mismatch: %v", err)
	}
	assertLocalImageFiles(t, config.RootDirectory, 2)
}

func TestLocalImageStoreCancelledActiveWriteCleansOwnedStage(t *testing.T) {
	store, config := localImageFixture(t)
	input := localImageInput(bytes.Repeat([]byte{5}, 32*1024*1024))
	_, stage, _ := LocalImageObjectNames(input.Key)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := store.Put(ctx, input); result <- err }()
	deadline := time.Now().Add(5 * time.Second)
	observed := false
	for time.Now().Before(deadline) {
		if _, err := os.Lstat(filepath.Join(config.RootDirectory, stage)); err == nil {
			observed = true
			break
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	assertLocalImageError(t, <-result, "LOCAL_IMAGE_ABORTED")
	if !observed {
		t.Fatal("active stage was not observed")
	}
	assertLocalImageFiles(t, config.RootDirectory, 1)
}

func TestLocalImageStoreStreamBoundAndCancellation(t *testing.T) {
	store, _ := localImageFixture(t)
	input := localImageInput(bytes.Repeat([]byte{9}, 2*1024*1024))
	if _, err := store.Put(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	reader, err := store.Open(context.Background(), input.LocalImageObject)
	if err != nil {
		t.Fatal(err)
	}
	// Public response metadata cannot change the expected content identity.
	reader.ByteLength = 1
	reader.SHA256 = strings.Repeat("0", 64)
	buffer := make([]byte, len(input.Bytes))
	var total int64
	for {
		n, err := reader.Read(buffer)
		if n > 64*1024 {
			t.Fatal("reader returned an unbounded chunk")
		}
		total += int64(n)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if total != input.ByteLength {
		t.Fatalf("wrong streamed length %d", total)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	reader, err = store.Open(ctx, input.LocalImageObject)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	_, err = reader.Read(buffer)
	assertLocalImageError(t, err, "LOCAL_IMAGE_ABORTED")
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Delete(context.Background(), input.LocalImageObject); err != nil {
		t.Fatal(err)
	}
}
