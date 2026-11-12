"""Chat traces: find them in text, using the one list in .github/chat-traces.txt.

A chat trace is anything that points at one Claude chat or session: a link to a session, a
chat, a shared chat or a project, a session's id, the session trailer. None is ever published
in this repository (CLAUDE.md). A Co-Authored-By line is allowed, and so is a generated-with
footer that links only to Claude Code itself, not to a chat.
"""

import re
from pathlib import Path

PATTERNS = Path(__file__).resolve().parent.parent / ".github" / "chat-traces.txt"


def _load(path=PATTERNS):
    lines = path.read_text(encoding="utf-8").splitlines()
    return [re.compile(line, re.IGNORECASE) for line in lines if line.strip() and not line.startswith("#")]


TRACES = _load()


def has_trace(line):
    return any(pattern.search(line) for pattern in TRACES)


def find(text):
    """The lines of `text` that carry a trace, as (line number from 1, line)."""
    return [(number, line) for number, line in enumerate(text.splitlines(), 1) if has_trace(line)]


_RULE = re.compile(r"^ {0,3}([-*_])( *\1){2,} *$")  # a Markdown horizontal rule: ---, ***, ___
_IN_TITLE = [re.compile(r"\S*(?:" + pattern.pattern + r")\S*", re.IGNORECASE) for pattern in TRACES]


def _is_content(line):
    bare = line.rstrip("\r\n")
    return bare.strip() != "" and not _RULE.match(bare)


def remove(text):
    """`text` without the lines that carry a trace; every other line kept as it was.

    When the traces were at the end (as a footer), the blank lines and the rule left above them go
    too, so the text ends where its own content does.
    """
    lines = text.splitlines(keepends=True)
    kept, last_content, last_trace = [], -1, -1
    for line in lines:
        if has_trace(line):
            last_trace = len(kept)
            continue
        kept.append(line)
        if _is_content(line):
            last_content = len(kept) - 1
    if last_trace < 0:
        return text
    if last_trace > last_content:
        kept = kept[: last_content + 1]
        if kept:
            kept[-1] = kept[-1].rstrip("\r\n")
    return "".join(kept)


def remove_from_title(title):
    """A one-line title without its traces, the words around them kept."""
    for pattern in _IN_TITLE:
        title = pattern.sub("", title)
    return " ".join(title.split())


# On GitHub ----------------------------------------------------------------------------------
# The "No chat traces" workflow runs `python3 scripts/chat_traces.py github` on every write a
# trace could ride in on, and on a schedule. What's written on GitHub (pull requests, issues,
# comments, reviews, release notes) is cleaned in place. What can't be rewritten from here
# fails the check instead: commit and tag messages, files, and an earlier version of edited
# text, which GitHub keeps in its "edited" menu and its API can't delete. On a public
# repository the check's log is public, so it names where a trace is, never the trace.

import json  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402

ZERO = "0" * 40


@dataclass
class Report:
    cleaned: list = field(default_factory=list)  # what was taken out, where
    problems: list = field(default_factory=list)  # what's still there, where
    warnings: list = field(default_factory=list)  # what couldn't be checked


class GitHub:
    """GitHub's REST API, as the workflow's token allows."""

    def __init__(self, api_url, repository, token):
        self.api = api_url.rstrip("/")
        self.repo = f"{self.api}/repos/{repository}"
        self.graphql = f"{self.api}/graphql"
        self.token = token

    def request(self, method, url, data=None):
        if not url.startswith(self.api + "/"):
            raise ValueError(f"not a GitHub API address: {url}")
        request = urllib.request.Request(url, method=method, data=None if data is None else json.dumps(data).encode(), headers={
            "Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "no-chat-traces"})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response), response.headers.get("Link", "")

    def get(self, url):
        return self.request("GET", url)[0]

    def pages(self, url):
        url = f"{url}{'&' if '?' in url else '?'}per_page=100"
        while url:
            items, link = self.request("GET", url)
            yield from items
            url = next((part.split(";")[0].strip(" <>") for part in link.split(",") if 'rel="next"' in part), None)


_CLEANERS = {"title": remove_from_title, "name": remove_from_title, "body": remove}


def _lines(count):
    return f"{count} trace line{'' if count == 1 else 's'}"


def clean(github, report, what, url, current, fields, method="PATCH"):
    """Write back `current`'s fields without their traces, if any had one."""
    changes, counts = {}, {}
    for name, label in fields.items():
        value = current.get(name) or ""
        cleaned = _CLEANERS[name](value)
        if cleaned != value:
            changes[name] = cleaned or ("Untitled" if name in ("title", "name") else "")
            counts[label] = len(find(value)) or 1
    if not changes:
        return
    try:
        github.request(method, url, changes)
    except urllib.error.HTTPError as error:
        report.problems += [f"{what}: {label} still has {_lines(n)}; GitHub refused the edit ({error.code})" for label, n in counts.items()]
        return
    report.cleaned += [f"{what}: {label}, {_lines(n)} taken out" for label, n in counts.items()]


_EDITS = """query($id: ID!) { node(id: $id) { ... on UserContentEditable {
  userContentEdits(first: 100) { nodes { editedAt deletedAt diff } } } } }"""


def earlier_versions(github, report, what, label, node_id):
    """Fail on an earlier version of edited text, kept in its edit history, that shows a trace."""
    if not node_id:
        return
    try:
        answer, _ = github.request("POST", github.graphql, {"query": _EDITS, "variables": {"id": node_id}})
    except urllib.error.HTTPError as error:
        report.warnings.append(f"{what}: its edit history couldn't be read ({error.code})")
        return
    node = (answer.get("data") or {}).get("node") or {}
    edits = (node.get("userContentEdits") or {}).get("nodes")
    if edits is None:
        reason = "; ".join(error.get("message", "?") for error in answer.get("errors") or []) or "none returned"
        report.warnings.append(f"{what}: its edit history couldn't be read ({reason})")
        return
    # The newest is the text as it is now (checked above); one deleted has no text left.
    earlier = sorted(edits, key=lambda edit: edit.get("editedAt") or "")[:-1]
    count = sum(1 for edit in earlier if not edit.get("deletedAt") and find(edit.get("diff") or ""))
    if count:
        versions = "1 earlier version" if count == 1 else f"{count} earlier versions"
        report.problems.append(f"{what}: {versions} of its {label} still shows a trace;"
                               f" delete it in the {label}'s edited menu, then run this check again")


def _git(folder, *args):
    return subprocess.run(["git", *args], cwd=folder, capture_output=True, text=True, check=True).stdout


def _exists(folder, revision):
    return subprocess.run(["git", "cat-file", "-e", f"{revision}^{{commit}}"], cwd=folder, capture_output=True).returncode == 0


def commit_problems(folder, revisions):
    problems = []
    for record in _git(folder, "log", "--format=%H%x00%B%x1e", *revisions).split("\x1e"):
        sha, _, message = record.strip("\n").partition("\x00")
        problems += [f"commit {sha[:12]}: its message, line {number}" for number, _ in find(message)]
    return problems


def tag_problems(folder, name, sha):
    if _git(folder, "cat-file", "-t", sha).strip() != "tag":
        return []  # a lightweight tag has no message
    message = _git(folder, "cat-file", "-p", sha).partition("\n\n")[2]
    return [f"tag {name}: its message, line {number}" for number, _ in find(message)]


def tree_problems(folder):
    problems = []
    for path in _git(folder, "ls-files", "-z").split("\0"):
        file = Path(folder, path)
        if not path or not file.is_file():
            continue
        data = file.read_bytes()
        if b"\0" in data[:8000]:
            continue  # binary
        problems += [f"file {path}, line {number}" for number, _ in find(data.decode("utf-8", "replace"))]
    return problems


def _pushed(payload, folder):
    """The commits a push brought that its branch (or, for a new one, the default branch) hadn't."""
    default = f"refs/remotes/origin/{payload['repository']['default_branch']}"
    after = payload["after"]
    if payload["ref"].startswith("refs/tags/"):
        after += "^{commit}"
    before = payload.get("before", ZERO)
    if before != ZERO and _exists(folder, before):
        return [after, "--not", before]
    return [after, "--not", default] if _exists(folder, default) else [after]


def _written(name, payload):
    """What an event wrote on GitHub: (what, API address, fields to clean with their labels,
    method, node id for its edit history)."""
    if name == "pull_request":
        pr = payload["pull_request"]
        return [(f"pull request #{pr['number']}", pr["url"], {"title": "title", "body": "description"}, "PATCH", pr.get("node_id"))]
    if name == "issues":
        issue = payload["issue"]
        return [(f"issue #{issue['number']}", issue["url"], {"title": "title", "body": "description"}, "PATCH", issue.get("node_id"))]
    if name in ("issue_comment", "pull_request_review_comment"):
        comment = payload["comment"]
        return [(f"comment {comment['id']}", comment["url"], {"body": "text"}, "PATCH", comment.get("node_id"))]
    if name == "pull_request_review":
        review, pr = payload["review"], payload["pull_request"]
        return [(f"review {review['id']} on pull request #{pr['number']}", f"{pr['url']}/reviews/{review['id']}", {"body": "text"}, "PUT", review.get("node_id"))]
    if name == "release":  # a release keeps no edit history
        release = payload["release"]
        return [(f"release {release['id']}", release["url"], {"name": "name", "body": "notes"}, "PATCH", None)]
    return []


def sweep(github, report):
    """Everything already published on GitHub, cleaned."""
    for issue in github.pages(f"{github.repo}/issues?state=all"):
        kind = "pull request" if "pull_request" in issue else "issue"
        what = f"{kind} #{issue['number']}"
        clean(github, report, what, issue["url"], issue, {"title": "title", "body": "description"})
        earlier_versions(github, report, what, "description", issue.get("node_id"))
        if "pull_request" in issue:
            reviews = f"{github.repo}/pulls/{issue['number']}/reviews"
            for review in github.pages(reviews):
                what = f"review {review['id']} on pull request #{issue['number']}"
                clean(github, report, what, f"{reviews}/{review['id']}", review, {"body": "text"}, "PUT")
                earlier_versions(github, report, what, "text", review.get("node_id"))
    for listing in ("issues/comments", "pulls/comments"):
        for comment in github.pages(f"{github.repo}/{listing}"):
            clean(github, report, f"comment {comment['id']}", comment["url"], comment, {"body": "text"})
            earlier_versions(github, report, f"comment {comment['id']}", "text", comment.get("node_id"))
    for release in github.pages(f"{github.repo}/releases"):
        clean(github, report, f"release {release['id']}", release["url"], release, {"name": "name", "body": "notes"})


def run(name, payload, github, folder):
    """Handle one GitHub event; `folder` is the repository's checkout, with its full history."""
    report = Report()
    for what, url, fields, method, node_id in _written(name, payload):
        try:
            current = github.get(url)
        except urllib.error.HTTPError as error:
            report.problems.append(f"{what}: couldn't be read ({error.code})")
            continue
        clean(github, report, what, url, current, fields, method)
        earlier_versions(github, report, what, fields.get("body", "text"), node_id)
    if name in ("schedule", "workflow_dispatch"):
        sweep(github, report)
        report.problems += commit_problems(folder, ["--all"])
        for line in _git(folder, "for-each-ref", "refs/tags", "--format=%(refname:short) %(objectname)").splitlines():
            tag, sha = line.rsplit(" ", 1)
            report.problems += tag_problems(folder, tag, sha)
    elif name == "pull_request":
        pr = payload["pull_request"]
        report.problems += commit_problems(folder, [pr["head"]["sha"], "--not", pr["base"]["sha"]])
    elif name == "push" and not payload.get("deleted"):
        if payload["ref"].startswith("refs/tags/"):
            report.problems += tag_problems(folder, payload["ref"][len("refs/tags/"):], payload["after"])
        report.problems += commit_problems(folder, _pushed(payload, folder))
    if name in ("schedule", "workflow_dispatch", "pull_request", "push") and not payload.get("deleted"):
        report.problems += tree_problems(folder)
    return report


def main():
    env = os.environ
    github = GitHub(env.get("GITHUB_API_URL", "https://api.github.com"), env["GITHUB_REPOSITORY"], env["GITHUB_TOKEN"])
    payload = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    report = run(env["GITHUB_EVENT_NAME"], payload, github, ".")
    for line in report.cleaned:
        print(f"::notice::Chat traces taken out of {line}")
    for line in report.problems:
        print(f"::error::A chat trace in {line}")
    for line in report.warnings:
        print(f"::warning::Not checked: {line}")
    if env.get("GITHUB_STEP_SUMMARY"):
        with open(env["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write("### No chat traces\n\n")
            summary.writelines(f"- Taken out of {line}\n" for line in report.cleaned)
            summary.writelines(f"- **Still in {line}**: rewrite it out (see CLAUDE.md)\n" for line in report.problems)
            summary.writelines(f"- Not checked: {line}\n" for line in report.warnings)
            if not report.cleaned and not report.problems and not report.warnings:
                summary.write("None found.\n")
    return 1 if report.problems else 0


if __name__ == "__main__" and sys.argv[1:] == ["github"]:
    sys.exit(main())
