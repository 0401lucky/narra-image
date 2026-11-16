package worker

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
)

const LocalImageVolumeMarker = ".narra-image-volume-v1"
const localImageMarkerPrefix = "narra-image-volume-v1\n"
const localImageChunkBytes = 64 * 1024

var localImageUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var localImageDigest = regexp.MustCompile(`^[0-9a-f]{64}$`)
var localImageKeySegment = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

type LocalImageStoreError struct{ Code string }

func (err *LocalImageStoreError) Error() string { return err.Code }

func localImageError(code string) error { return &LocalImageStoreError{Code: code} }
func normalizeLocalImageError(err error) error {
	if err == nil {
		return nil
	}
	var known *LocalImageStoreError
	if errors.As(err, &known) {
		return known
	}
	return localImageError("LOCAL_IMAGE_STORAGE_UNAVAILABLE")
}

func localImageAborted(ctx context.Context) error {
	if ctx.Err() != nil {
		return localImageError("LOCAL_IMAGE_ABORTED")
	}
	return nil
}

type LocalImageStoreConfig struct {
	RootDirectory string
	VolumeID      string
}

type LocalImageVolume struct {
	VolumeID   string
	LocationID string
}

type LocalImageObject struct {
	Key        string
	ByteLength int64
	SHA256     string
}

type LocalImagePutInput struct {
	LocalImageObject
	Bytes []byte
}

type LocalImageMetadata struct {
	ByteLength int64
	SHA256     string
}

type LocalImageDeleteOutcome string

const (
	LocalImageDeleted LocalImageDeleteOutcome = "deleted"
	LocalImageMissing LocalImageDeleteOutcome = "missing"
)

type LocalImageStore struct{ config LocalImageStoreConfig }

func NewLocalImageStore(config LocalImageStoreConfig) (*LocalImageStore, error) {
	if !filepath.IsAbs(config.RootDirectory) || strings.ContainsRune(config.RootDirectory, 0) || !localImageUUID.MatchString(config.VolumeID) {
		return nil, localImageError("LOCAL_IMAGE_INVALID_CONFIG")
	}
	config.RootDirectory = filepath.Clean(config.RootDirectory)
	if filepath.Dir(config.RootDirectory) == config.RootDirectory {
		return nil, localImageError("LOCAL_IMAGE_INVALID_CONFIG")
	}
	return &LocalImageStore{config: config}, nil
}

func LocalImageObjectNames(key string) (object, staging string, err error) {
	if len(key) == 0 || len(key) > 512 {
		return "", "", localImageError("LOCAL_IMAGE_INVALID_OBJECT")
	}
	for _, segment := range strings.Split(key, "/") {
		if !localImageKeySegment.MatchString(segment) {
			return "", "", localImageError("LOCAL_IMAGE_INVALID_OBJECT")
		}
	}
	digest := sha256.Sum256([]byte(key))
	encoded := hex.EncodeToString(digest[:])
	return "image-" + encoded + ".bin", ".image-" + encoded + ".writing", nil
}

func validateLocalImageObject(input LocalImageObject) (string, string, error) {
	if input.ByteLength < 1 || input.ByteLength > ImageMaxBytes || !localImageDigest.MatchString(input.SHA256) {
		return "", "", localImageError("LOCAL_IMAGE_INVALID_OBJECT")
	}
	return LocalImageObjectNames(input.Key)
}

func (store *LocalImageStore) volume() LocalImageVolume {
	return LocalImageVolume{VolumeID: store.config.VolumeID, LocationID: "local-v1:" + store.config.VolumeID}
}

func (store *LocalImageStore) markerBytes() []byte {
	return []byte(localImageMarkerPrefix + store.config.VolumeID + "\n")
}

type localImageReadRoot interface {
	Lstat(name string) (os.FileInfo, error)
	Open(name string) (*os.File, error)
}

func localImageStat(root localImageReadRoot, name string) (os.FileInfo, error) {
	info, err := root.Lstat(name)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return info, err
}

func (store *LocalImageStore) openRoot(ctx context.Context) (*os.Root, error) {
	if err := localImageAborted(ctx); err != nil {
		return nil, err
	}
	requested, err := os.Lstat(store.config.RootDirectory)
	if err != nil {
		return nil, localImageError("LOCAL_IMAGE_VOLUME_UNAVAILABLE")
	}
	if !requested.IsDir() || requested.Mode()&os.ModeSymlink != 0 {
		return nil, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	canonical, err := filepath.EvalSymlinks(store.config.RootDirectory)
	if err != nil {
		return nil, localImageError("LOCAL_IMAGE_VOLUME_UNAVAILABLE")
	}
	root, err := os.OpenRoot(canonical)
	if err != nil {
		return nil, localImageError("LOCAL_IMAGE_VOLUME_UNAVAILABLE")
	}
	identity, err := root.Stat(".")
	if err != nil || !identity.IsDir() || !os.SameFile(requested, identity) {
		root.Close()
		return nil, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := localImageAborted(ctx); err != nil {
		root.Close()
		return nil, err
	}
	return root, nil
}

func openLocalImageRegular(root localImageReadRoot, name string, expectedLength int64) (*os.File, os.FileInfo, error) {
	before, err := localImageStat(root, name)
	if err != nil {
		return nil, nil, normalizeLocalImageError(err)
	}
	if before == nil {
		return nil, nil, localImageError("LOCAL_IMAGE_NOT_FOUND")
	}
	if !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 {
		return nil, nil, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, nil, normalizeLocalImageError(err)
	}
	identity, statErr := file.Stat()
	after, pathErr := root.Lstat(name)
	if statErr != nil || pathErr != nil || !identity.Mode().IsRegular() || after.Mode()&os.ModeSymlink != 0 ||
		!os.SameFile(before, identity) || !os.SameFile(after, identity) {
		file.Close()
		return nil, nil, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if identity.Size() != expectedLength {
		file.Close()
		return nil, nil, localImageError("LOCAL_IMAGE_CONTENT_MISMATCH")
	}
	return file, identity, nil
}

func (store *LocalImageStore) verifyMarker(ctx context.Context, root localImageReadRoot) error {
	initializing, err := localImageStat(root, LocalImageVolumeMarker+".writing")
	if err != nil {
		return normalizeLocalImageError(err)
	}
	if initializing != nil {
		return localImageError("LOCAL_IMAGE_VOLUME_UNAVAILABLE")
	}
	expected := store.markerBytes()
	file, _, err := openLocalImageRegular(root, LocalImageVolumeMarker, int64(len(expected)))
	if err != nil {
		var known *LocalImageStoreError
		if errors.As(err, &known) {
			switch known.Code {
			case "LOCAL_IMAGE_NOT_FOUND":
				return localImageError("LOCAL_IMAGE_VOLUME_UNAVAILABLE")
			case "LOCAL_IMAGE_CONTENT_MISMATCH":
				return localImageError("LOCAL_IMAGE_VOLUME_MISMATCH")
			}
		}
		return err
	}
	defer file.Close()
	actual, err := io.ReadAll(io.LimitReader(file, int64(len(expected)+1)))
	if err != nil {
		return normalizeLocalImageError(err)
	}
	if !bytes.Equal(actual, expected) {
		return localImageError("LOCAL_IMAGE_VOLUME_MISMATCH")
	}
	return localImageAborted(ctx)
}

func localImageNoPending(root localImageReadRoot, staging string) error {
	info, err := localImageStat(root, staging)
	if err != nil {
		return normalizeLocalImageError(err)
	}
	if info != nil {
		return localImageError("LOCAL_IMAGE_WRITE_PENDING")
	}
	return nil
}

func (store *LocalImageStore) openObject(ctx context.Context, root localImageReadRoot, objectName, stageName string, input LocalImageObject) (*os.File, os.FileInfo, error) {
	if err := localImageNoPending(root, stageName); err != nil {
		return nil, nil, err
	}
	file, identity, err := openLocalImageRegular(root, objectName, input.ByteLength)
	if err != nil {
		var known *LocalImageStoreError
		if errors.As(err, &known) && known.Code == "LOCAL_IMAGE_NOT_FOUND" {
			// A writer can create its stage after the first pending check.
			// Definitive absence also requires a current volume/stage check.
			if err := store.verifyMarker(ctx, root); err != nil {
				return nil, nil, err
			}
			if err := localImageNoPending(root, stageName); err != nil {
				return nil, nil, err
			}
			if err := localImageAborted(ctx); err != nil {
				return nil, nil, err
			}
		}
		return nil, nil, err
	}
	if err := localImageNoPending(root, stageName); err != nil {
		file.Close()
		return nil, nil, err
	}
	if err := localImageAborted(ctx); err != nil {
		file.Close()
		return nil, nil, err
	}
	return file, identity, nil
}

func syncLocalImageDirectory(root *os.Root) error {
	if runtime.GOOS == "windows" {
		return nil // Windows does not support flushing a directory handle.
	}
	directory, err := root.Open(".")
	if err != nil {
		return normalizeLocalImageError(err)
	}
	defer directory.Close()
	return normalizeLocalImageError(directory.Sync())
}

func removeOwnedLocalImage(root *os.Root, name string, identity os.FileInfo) error {
	current, err := localImageStat(root, name)
	if err != nil || current == nil {
		return normalizeLocalImageError(err)
	}
	if !current.Mode().IsRegular() || current.Mode()&os.ModeSymlink != 0 || !os.SameFile(current, identity) {
		return localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := root.Remove(name); err != nil {
		return normalizeLocalImageError(err)
	}
	return syncLocalImageDirectory(root)
}

func (store *LocalImageStore) Verify(ctx context.Context) (LocalImageVolume, error) {
	root, err := store.openRoot(ctx)
	if err != nil {
		return LocalImageVolume{}, err
	}
	defer root.Close()
	if err := store.verifyMarker(ctx, root); err != nil {
		return LocalImageVolume{}, err
	}
	return store.volume(), nil
}

// ProbeWritable tests creation, non-overwriting hard-link publication and removal.
// Verify is read-only; these two zero-byte probe paths are not managed images.
func (store *LocalImageStore) ProbeWritable(ctx context.Context) (result LocalImageVolume, resultErr error) {
	root, err := store.openRoot(ctx)
	if err != nil {
		return result, err
	}
	defer func() {
		if err := root.Close(); resultErr == nil {
			resultErr = normalizeLocalImageError(err)
		}
	}()
	if err := store.verifyMarker(ctx, root); err != nil {
		return result, err
	}
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return result, normalizeLocalImageError(err)
	}
	name := ".narra-image-probe-" + hex.EncodeToString(token[:])
	linkedName := name + ".linked"
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return result, normalizeLocalImageError(err)
	}
	identity, err := file.Stat()
	if err != nil {
		file.Close()
		return result, normalizeLocalImageError(err)
	}
	linkAttempted := false
	defer func() {
		closeErr := file.Close()
		var removeLinkErr error
		if linkAttempted {
			removeLinkErr = removeOwnedLocalImage(root, linkedName, identity)
		}
		removeErr := removeOwnedLocalImage(root, name, identity)
		if resultErr == nil {
			resultErr = normalizeLocalImageError(errors.Join(closeErr, removeLinkErr, removeErr))
		}
	}()
	if !identity.Mode().IsRegular() || identity.Size() != 0 {
		return result, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := file.Sync(); err != nil {
		return result, normalizeLocalImageError(err)
	}
	source, err := root.Lstat(name)
	if err != nil || !source.Mode().IsRegular() || !os.SameFile(source, identity) {
		return result, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := localImageAborted(ctx); err != nil {
		return result, err
	}
	linkAttempted = true
	if err := root.Link(name, linkedName); err != nil {
		return result, normalizeLocalImageError(err)
	}
	published, err := root.Lstat(linkedName)
	if err != nil || !published.Mode().IsRegular() || published.Size() != 0 || !os.SameFile(published, identity) {
		return result, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := root.Link(name, linkedName); !errors.Is(err, os.ErrExist) {
		if err != nil {
			return result, normalizeLocalImageError(err)
		}
		return result, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := syncLocalImageDirectory(root); err != nil {
		return result, err
	}
	if err := store.verifyMarker(ctx, root); err != nil {
		return result, err
	}
	return store.volume(), nil
}

func InitializeLocalImageVolume(ctx context.Context, config LocalImageStoreConfig) (result LocalImageVolume, resultErr error) {
	store, err := NewLocalImageStore(config)
	if err != nil {
		return result, err
	}
	root, err := store.openRoot(ctx)
	if err != nil {
		return result, err
	}
	defer root.Close()
	marker, err := localImageStat(root, LocalImageVolumeMarker)
	if err != nil {
		return result, normalizeLocalImageError(err)
	}
	if marker != nil {
		if err := store.verifyMarker(ctx, root); err != nil {
			return result, err
		}
		return store.volume(), nil
	}
	directory, err := root.Open(".")
	if err != nil {
		return result, normalizeLocalImageError(err)
	}
	entries, readErr := directory.ReadDir(1)
	directory.Close()
	if len(entries) != 0 || (readErr != nil && !errors.Is(readErr, io.EOF)) {
		return result, localImageError("LOCAL_IMAGE_VOLUME_UNAVAILABLE")
	}
	stageName := LocalImageVolumeMarker + ".writing"
	stage, err := root.OpenFile(stageName, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return result, normalizeLocalImageError(err)
	}
	identity, err := stage.Stat()
	if err != nil {
		stage.Close()
		return result, normalizeLocalImageError(err)
	}
	defer func() {
		closeErr := stage.Close()
		removeErr := removeOwnedLocalImage(root, stageName, identity)
		if resultErr == nil {
			resultErr = normalizeLocalImageError(errors.Join(closeErr, removeErr))
		}
	}()
	expectedMarker := store.markerBytes()
	if n, err := stage.Write(expectedMarker); err != nil || n != len(expectedMarker) {
		return result, localImageError("LOCAL_IMAGE_STORAGE_UNAVAILABLE")
	}
	if err := stage.Sync(); err != nil {
		return result, normalizeLocalImageError(err)
	}
	actualMarker, err := io.ReadAll(io.NewSectionReader(stage, 0, int64(len(expectedMarker)+1)))
	if err != nil || !bytes.Equal(actualMarker, expectedMarker) {
		return result, localImageError("LOCAL_IMAGE_VOLUME_MISMATCH")
	}
	if err := localImageAborted(ctx); err != nil {
		return result, err
	}
	if err := root.Link(stageName, LocalImageVolumeMarker); err != nil {
		return result, normalizeLocalImageError(err)
	}
	published, err := root.Lstat(LocalImageVolumeMarker)
	if err != nil || !published.Mode().IsRegular() || !os.SameFile(published, identity) {
		return result, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := syncLocalImageDirectory(root); err != nil {
		return result, err
	}
	return store.volume(), nil
}

func verifyLocalImageContent(ctx context.Context, file *os.File, input LocalImageObject) error {
	digest := sha256.New()
	buffer := make([]byte, localImageChunkBytes)
	var offset int64
	for offset < input.ByteLength {
		if err := localImageAborted(ctx); err != nil {
			return err
		}
		chunk := buffer[:min(int64(len(buffer)), input.ByteLength-offset)]
		n, err := file.ReadAt(chunk, offset)
		if n == 0 || (err != nil && !errors.Is(err, io.EOF)) {
			return localImageError("LOCAL_IMAGE_CONTENT_MISMATCH")
		}
		digest.Write(chunk[:n])
		offset += int64(n)
	}
	var extra [1]byte
	n, err := file.ReadAt(extra[:], offset)
	if n != 0 || (err != nil && !errors.Is(err, io.EOF)) || hex.EncodeToString(digest.Sum(nil)) != input.SHA256 {
		return localImageError("LOCAL_IMAGE_CONTENT_MISMATCH")
	}
	return localImageAborted(ctx)
}

func (store *LocalImageStore) Put(ctx context.Context, input LocalImagePutInput) (result LocalImageMetadata, resultErr error) {
	objectName, stageName, err := validateLocalImageObject(input.LocalImageObject)
	if err != nil {
		return result, err
	}
	if int64(len(input.Bytes)) != input.ByteLength {
		return result, localImageError("LOCAL_IMAGE_CONTENT_MISMATCH")
	}
	digest := sha256.Sum256(input.Bytes)
	if hex.EncodeToString(digest[:]) != input.SHA256 {
		return result, localImageError("LOCAL_IMAGE_CONTENT_MISMATCH")
	}
	root, err := store.openRoot(ctx)
	if err != nil {
		return result, err
	}
	defer root.Close()
	if err := store.verifyMarker(ctx, root); err != nil {
		return result, err
	}
	if err := localImageNoPending(root, stageName); err != nil {
		return result, err
	}
	current, err := localImageStat(root, objectName)
	if err != nil {
		return result, normalizeLocalImageError(err)
	}
	if current != nil {
		return result, localImageError("LOCAL_IMAGE_OBJECT_EXISTS")
	}
	stage, err := root.OpenFile(stageName, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return result, localImageError("LOCAL_IMAGE_WRITE_PENDING")
	}
	if err != nil {
		return result, normalizeLocalImageError(err)
	}
	identity, err := stage.Stat()
	if err != nil {
		stage.Close()
		return result, normalizeLocalImageError(err)
	}
	defer func() {
		closeErr := stage.Close()
		removeErr := removeOwnedLocalImage(root, stageName, identity)
		if resultErr == nil {
			resultErr = normalizeLocalImageError(errors.Join(closeErr, removeErr))
		}
	}()
	var offset int64
	for offset < input.ByteLength {
		if err := localImageAborted(ctx); err != nil {
			return result, err
		}
		end := min(offset+localImageChunkBytes, input.ByteLength)
		n, err := stage.WriteAt(input.Bytes[offset:end], offset)
		if err != nil || n == 0 {
			return result, localImageError("LOCAL_IMAGE_STORAGE_UNAVAILABLE")
		}
		offset += int64(n)
	}
	if err := stage.Sync(); err != nil {
		return result, normalizeLocalImageError(err)
	}
	if err := verifyLocalImageContent(ctx, stage, input.LocalImageObject); err != nil {
		return result, err
	}
	if err := store.verifyMarker(ctx, root); err != nil {
		return result, err
	}
	beforePublish, err := root.Lstat(stageName)
	if err != nil || !beforePublish.Mode().IsRegular() || !os.SameFile(beforePublish, identity) {
		return result, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := root.Link(stageName, objectName); err != nil {
		if errors.Is(err, os.ErrExist) {
			return result, localImageError("LOCAL_IMAGE_OBJECT_EXISTS")
		}
		return result, normalizeLocalImageError(err)
	}
	published, err := root.Lstat(objectName)
	if err != nil || !published.Mode().IsRegular() || !os.SameFile(published, identity) {
		return result, localImageError("LOCAL_IMAGE_UNSAFE_PATH")
	}
	if err := syncLocalImageDirectory(root); err != nil {
		return result, err
	}
	if err := localImageAborted(ctx); err != nil {
		return result, err
	}
	return LocalImageMetadata{ByteLength: input.ByteLength, SHA256: input.SHA256}, nil
}

type LocalImageReader struct {
	LocalImageMetadata
	expected  LocalImageMetadata
	ctx       context.Context
	file      *os.File
	root      *os.Root
	digest    hash.Hash
	offset    int64
	readMu    sync.Mutex
	closeOnce sync.Once
	done      chan struct{}
	closeErr  error
	verified  bool
}

func (reader *LocalImageReader) Close() error {
	reader.closeOnce.Do(func() {
		close(reader.done)
		reader.closeErr = normalizeLocalImageError(errors.Join(reader.file.Close(), reader.root.Close()))
	})
	return reader.closeErr
}

func (reader *LocalImageReader) Read(p []byte) (int, error) {
	reader.readMu.Lock()
	defer reader.readMu.Unlock()
	if len(p) == 0 {
		return 0, nil
	}
	if err := localImageAborted(reader.ctx); err != nil {
		reader.Close()
		return 0, err
	}
	if reader.verified {
		return 0, io.EOF
	}
	select {
	case <-reader.done:
		return 0, localImageError("LOCAL_IMAGE_STORAGE_UNAVAILABLE")
	default:
	}
	chunk := p[:min(int64(len(p)), min(int64(localImageChunkBytes), reader.expected.ByteLength-reader.offset))]
	n, err := reader.file.ReadAt(chunk, reader.offset)
	if n == 0 || (err != nil && !errors.Is(err, io.EOF)) {
		reader.Close()
		if abortErr := localImageAborted(reader.ctx); abortErr != nil {
			return 0, abortErr
		}
		return 0, localImageError("LOCAL_IMAGE_CONTENT_MISMATCH")
	}
	reader.digest.Write(chunk[:n])
	reader.offset += int64(n)
	if reader.offset == reader.expected.ByteLength {
		var extra [1]byte
		extraN, extraErr := reader.file.ReadAt(extra[:], reader.offset)
		if extraN != 0 || (extraErr != nil && !errors.Is(extraErr, io.EOF)) || hex.EncodeToString(reader.digest.Sum(nil)) != reader.expected.SHA256 {
			reader.Close()
			if abortErr := localImageAborted(reader.ctx); abortErr != nil {
				return 0, abortErr
			}
			return 0, localImageError("LOCAL_IMAGE_CONTENT_MISMATCH")
		}
		// Withhold the last chunk until hash/length checks pass, so a corrupt
		// object never produces a complete-looking HTTP body.
		if err := localImageAborted(reader.ctx); err != nil {
			reader.Close()
			return 0, err
		}
		reader.verified = true
		if err := reader.Close(); err != nil {
			return 0, err
		}
	}
	return n, nil
}

func (store *LocalImageStore) Open(ctx context.Context, input LocalImageObject) (*LocalImageReader, error) {
	objectName, stageName, err := validateLocalImageObject(input)
	if err != nil {
		return nil, err
	}
	root, err := store.openRoot(ctx)
	if err != nil {
		return nil, err
	}
	if err := store.verifyMarker(ctx, root); err != nil {
		root.Close()
		return nil, err
	}
	file, _, err := store.openObject(ctx, root, objectName, stageName, input)
	if err != nil {
		root.Close()
		return nil, err
	}
	expected := LocalImageMetadata{ByteLength: input.ByteLength, SHA256: input.SHA256}
	reader := &LocalImageReader{
		LocalImageMetadata: expected, expected: expected,
		ctx: ctx, file: file, root: root, digest: sha256.New(), done: make(chan struct{}),
	}
	go func() {
		select {
		case <-ctx.Done():
			reader.Close()
		case <-reader.done:
		}
	}()
	if err := localImageAborted(ctx); err != nil {
		reader.Close()
		return nil, err
	}
	return reader, nil
}

func (store *LocalImageStore) Read(ctx context.Context, input LocalImageObject) ([]byte, error) {
	reader, err := store.Open(ctx, input)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	result, err := io.ReadAll(reader)
	if err != nil {
		return nil, normalizeLocalImageError(err)
	}
	return result, nil
}

func (store *LocalImageStore) Head(ctx context.Context, input LocalImageObject) (LocalImageMetadata, error) {
	objectName, stageName, err := validateLocalImageObject(input)
	if err != nil {
		return LocalImageMetadata{}, err
	}
	root, err := store.openRoot(ctx)
	if err != nil {
		return LocalImageMetadata{}, err
	}
	defer root.Close()
	if err := store.verifyMarker(ctx, root); err != nil {
		return LocalImageMetadata{}, err
	}
	file, _, err := store.openObject(ctx, root, objectName, stageName, input)
	if err != nil {
		return LocalImageMetadata{}, err
	}
	defer file.Close()
	if err := localImageAborted(ctx); err != nil {
		return LocalImageMetadata{}, err
	}
	return LocalImageMetadata{ByteLength: input.ByteLength, SHA256: input.SHA256}, nil
}

func (store *LocalImageStore) Delete(ctx context.Context, input LocalImageObject) (LocalImageDeleteOutcome, error) {
	objectName, stageName, err := validateLocalImageObject(input)
	if err != nil {
		return "", err
	}
	root, err := store.openRoot(ctx)
	if err != nil {
		return "", err
	}
	defer root.Close()
	if err := store.verifyMarker(ctx, root); err != nil {
		return "", err
	}
	file, identity, err := store.openObject(ctx, root, objectName, stageName, input)
	if err != nil {
		var known *LocalImageStoreError
		if errors.As(err, &known) && known.Code == "LOCAL_IMAGE_NOT_FOUND" {
			return LocalImageMissing, nil
		}
		return "", err
	}
	verifyErr := verifyLocalImageContent(ctx, file, input)
	closeErr := file.Close()
	if verifyErr != nil || closeErr != nil {
		return "", normalizeLocalImageError(errors.Join(verifyErr, closeErr))
	}
	if err := store.verifyMarker(ctx, root); err != nil {
		return "", err
	}
	if err := localImageNoPending(root, stageName); err != nil {
		return "", err
	}
	if err := localImageAborted(ctx); err != nil {
		return "", err
	}
	if err := removeOwnedLocalImage(root, objectName, identity); err != nil {
		return "", err
	}
	return LocalImageDeleted, nil
}
