"""Linux-only carry helper. The source is always a read-only mount; the core owns the journal."""

import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

LIMIT = 1024 ** 3
PROFILE = '.browser-profiles/driver/main'
# Sign-ins live outside these; the browser rebuilds them, and they are most of a used profile's size.
PROFILE_LEFT = ('Singleton*', 'Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache',
                'DawnGraphiteCache', 'DawnWebGPUCache', 'GraphiteDawnCache')


def safe(root, relative):
    path = root / relative
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise ValueError('symlink destination')
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('outside destination')
    return path


def inventory(source, excluded):
    files, size, skipped = [], 0, 0
    for parent, dirs, names in os.walk(source, followlinks=False):
        dirs[:] = [name for name in dirs if name not in excluded and not (Path(parent) / name).is_symlink()]
        for name in names:
            path = Path(parent) / name
            if name in excluded or path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
                skipped += 1
                continue
            size += path.stat().st_size
            files.append(path.relative_to(source))
    return files, size, skipped


def execute(args, source=Path('/from'), destination=Path('/to')):
    operation = args['operation']
    if operation == 'scan':
        profile = safe(source, PROFILE)
        cookies = safe(source, PROFILE + '/Default/Cookies')
        _, size, _ = inventory(source, set(args['excluded']))
        return {'cookies': cookies.stat().st_mtime_ns if cookies.is_file() and not cookies.is_symlink() else 0,
                'bytes': size,
                'profile': profile.is_dir() and not profile.is_symlink(),
                'destination_profile': os.path.lexists(destination / PROFILE),
                'folders': [p.name for p in destination.iterdir()]}
    excluded = set(args['excluded'])
    files, size, skipped = inventory(source, excluded)
    folder = safe(destination, args['folder'])
    data = safe(destination, '.raphael-data/members/' + args['key'])
    marker = folder / '.raphael-carried-member'
    existing = folder.exists()
    if existing and (marker.is_symlink() or not marker.is_file() or marker.read_text() != args['key']):
        raise ValueError('member folder already exists')
    result = {'files': 'left_in_place' if size > LIMIT else 'carried', 'bytes': size,
              'excluded': sorted(excluded), 'skipped_links_or_special': skipped,
              'folder': args['folder'], 'datasets': [], 'profile': 'skipped'}

    def own(tree):
        # Only ever a tree this run staged inside its own temporary folder: a walk that starts at a path the
        # members prepared (a link named .browser-profiles) would hand out whatever it points to. A member that
        # swaps the staging folder's own name while this runs can still turn the walk, but only inside this
        # throwaway container: its one writable mount is the workspace every member owns, /from is read-only.
        for parent, dirs, names in os.walk(tree, followlinks=False):
            os.chown(parent, 1000, 1000, follow_symlinks=False)
            for name in dirs + names:
                os.chown(Path(parent) / name, 1000, 1000, follow_symlinks=False)

    def own_folders(*relatives):
        # Folders this run may have made on the way, one by one and checked again; never their contents.
        for relative in relatives:
            if os.path.lexists(destination / relative):
                os.chown(safe(destination, relative), 1000, 1000, follow_symlinks=False)

    # Sign-ins first: they are what can no longer be carried once the browser has started on an empty profile.
    if args['profile']:
        target = safe(destination, PROFILE)
        if os.path.lexists(target):
            result['profile'] = 'kept_existing'
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Before the long copy: the browser that could not wait must be able to make its own profile here.
            own_folders('.browser-profiles', '.browser-profiles/driver')
            with tempfile.TemporaryDirectory(prefix='.carry-profile-', dir=target.parent) as temporary:
                staged = Path(temporary) / 'main'
                shutil.copytree(safe(source, PROFILE), staged, symlinks=True,
                                ignore=shutil.ignore_patterns(*PROFILE_LEFT))
                own(staged)
                try:
                    staged.rename(target)
                    result['profile'] = 'carried'
                except OSError:
                    # The browser started meanwhile and wrote its own profile: that one stays. (A folder its
                    # launcher has only just made, still empty, is no profile: rename puts the carried one there.)
                    if not os.path.lexists(target):
                        raise
                    result['profile'] = 'kept_existing'
    # Above the limit only the files stay where they are: the home's sign-ins and datasets are still carried.
    if size <= LIMIT and not existing:
        # Publish a complete folder once, so failure before rename cannot expose a partial file set.
        with tempfile.TemporaryDirectory(prefix='.raphael-carry-', dir=destination) as temporary:
            staged = Path(temporary) / 'files'
            staged.mkdir()
            for relative in files:
                target = staged / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source / relative, target, follow_symlinks=False)
            (staged / '.raphael-carried-member').write_text(args['key'])
            own(staged)
            staged.rename(folder)
    databases = source / '.raphael-data'
    if not databases.is_symlink():
        for database in sorted(databases.glob('*.duckdb')):
            if database.is_symlink() or not database.is_file():
                continue
            data.mkdir(parents=True, exist_ok=True)
            # At once, not after the copies: a copy that fails must not leave the member a folder it cannot use.
            own_folders('.raphael-data', '.raphael-data/members', '.raphael-data/members/' + args['key'])
            target = safe(data, database.name)
            if target.exists():
                result['datasets'].append({'name': database.name, 'status': 'kept_existing'})
            else:
                with tempfile.NamedTemporaryFile(dir=data, delete=False) as stream:
                    temporary = Path(stream.name)
                try:
                    shutil.copy2(database, temporary)
                    os.chown(temporary, 1000, 1000, follow_symlinks=False)
                    temporary.replace(target)
                finally:
                    temporary.unlink(missing_ok=True)
                result['datasets'].append({'name': database.name, 'status': 'carried'})
    return result


if __name__ == '__main__':
    print(json.dumps(execute(json.loads(sys.argv[1]))))
