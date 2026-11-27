"""A GitHub that answers from a dictionary: the API's commit and tree listings and the raw files, by commit.

Nothing here touches the network. `requests` lists every URL asked, so a test can say what was and was not downloaded."""

import hashlib
import posixpath
from urllib.parse import unquote

import httpx


def blob_sha(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


class FakeGitHub:
    def __init__(self, monkeypatch):
        self.repos = {}
        self.requests = []
        # url fragment -> a response (or an exception to raise) for any request whose URL holds it
        self.fail = {}
        original = httpx.AsyncClient
        monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(self.handle), **kwargs))

    def add(self, repo, files, *, branch="main", refs=(), sizes=None, truncate_root=False, modes=None):
        """`files` is {path: bytes}; `sizes` overrides the size a listing declares (a file nobody downloads)."""
        sha = hashlib.sha1(repr((repo, sorted(files.items()))).encode()).hexdigest()
        self.repos[repo] = {"files": dict(files), "sha": sha, "refs": {"HEAD": sha, branch: sha, **{ref: sha for ref in refs}},
                            "branch": branch, "sizes": sizes or {}, "truncate_root": truncate_root, "modes": modes or {}}
        return sha

    def raw_requests(self):
        return [url for url in self.requests if "raw.githubusercontent.com" in url]

    def _entries(self, repo, prefix=""):
        data = self.repos[repo]
        entries, folders = [], set()
        for path in sorted(data["files"]):
            if prefix and not path.startswith(prefix + "/"):
                continue
            relative = path[len(prefix) + 1:] if prefix else path
            parts = relative.split("/")
            for index in range(1, len(parts)):
                folders.add("/".join(parts[:index]))
            body = data["files"][path]
            mode = data["modes"].get(path, "100644")
            entries.append({"path": relative, "type": "commit" if mode == "160000" else "blob", "mode": mode,
                            "size": data["sizes"].get(path, len(body)), "sha": blob_sha(body)})
        for folder in sorted(folders):
            entries.append({"path": folder, "type": "tree", "mode": "040000", "sha": self._tree_sha(repo, prefix, folder)})
        return entries

    @staticmethod
    def _tree_sha(repo, prefix, folder):
        return hashlib.sha1(f"tree:{repo}:{posixpath.join(prefix, folder)}".encode()).hexdigest()

    def handle(self, request):
        url = str(request.url)
        self.requests.append(url)
        for fragment, answer in self.fail.items():
            if fragment in url:
                if isinstance(answer, Exception):
                    raise answer
                return answer
        path = unquote(request.url.path)
        if request.url.host == "api.github.com":
            parts = path.strip("/").split("/")
            if len(parts) < 3 or parts[0] != "repos":
                return httpx.Response(404)
            repo = f"{parts[1]}/{parts[2]}"
            if repo not in self.repos:
                return httpx.Response(404, json={"message": "Not Found"})
            data = self.repos[repo]
            rest = parts[3:]
            if rest == []:
                return httpx.Response(200, json={"default_branch": data["branch"]})
            if rest[0] == "commits":
                ref = "/".join(rest[1:])
                if ref in data["refs"]:
                    return httpx.Response(200, json={"sha": data["refs"][ref]})
                if ref == data["sha"]:
                    return httpx.Response(200, json={"sha": ref})
                return httpx.Response(404, json={"message": "No commit found"})
            if rest[:2] == ["git", "trees"]:
                tree = rest[2]
                recursive = request.url.params.get("recursive") == "1"
                if tree == data["sha"]:
                    if recursive:
                        if data["truncate_root"]:
                            return httpx.Response(200, json={"sha": tree, "truncated": True, "tree": self._entries(repo)[:3]})
                        return httpx.Response(200, json={"sha": tree, "truncated": False, "tree": self._entries(repo)})
                    top = [e for e in self._entries(repo) if "/" not in e["path"]]
                    return httpx.Response(200, json={"sha": tree, "truncated": False, "tree": top})
                names = {"/".join(p.split("/")[:i]) for p in data["files"] for i in range(1, len(p.split("/")))}
                folders = {self._tree_sha(repo, "", name): name for name in names}
                if tree in folders:
                    entries = self._entries(repo, folders[tree])
                    if not recursive:
                        entries = [e for e in entries if "/" not in e["path"]]
                    return httpx.Response(200, json={"sha": tree, "truncated": False, "tree": entries})
                return httpx.Response(404)
            return httpx.Response(404)
        if request.url.host == "raw.githubusercontent.com":
            parts = path.strip("/").split("/", 3)
            repo = f"{parts[0]}/{parts[1]}"
            data = self.repos.get(repo)
            if data is None or len(parts) < 4 or (parts[2] != data["sha"] and parts[2] not in data["refs"]):
                return httpx.Response(404)
            body = data["files"].get(parts[3])
            return httpx.Response(200, content=body) if body is not None else httpx.Response(404)
        return httpx.Response(404)
