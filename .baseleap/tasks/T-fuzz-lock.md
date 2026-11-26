# Generate the hash-locked fuzz dependency file (closes SEC-25 to Minor)

**For Matthew.** About 10 minutes. **Unblocks:** the security review's last Important finding (SEC-25), so SEC1 can turn APPROVED and the release (DEP1) check passes.

**Why:** QA's fuzz tool (Schemathesis 4.0.0, test-only, never shipped) installs ~54 helper packages with no fixed versions or checksums. Those run in this repo, where `.env.local` holds the ledger key and the staging keys. A hash lock means only the exact, checksummed packages can ever install. Agents can't make this file: it needs pip and the internet, which their sessions refuse.

## Steps (on this machine, in a terminal of your own, not through Claude)
1. Open a terminal and go to the repo: `cd /home/admin/baseleap/rehearsal/northside-quotes`
   You should see the prompt end in `northside-quotes`.
2. Make a throwaway tool folder outside the repo: `python3 -m venv /tmp/locktool && /tmp/locktool/bin/pip install uv`
   You should see "Successfully installed uv-…".
3. Write the one-line input file: `echo "schemathesis==4.0.0" > /tmp/fuzz-req.in`
4. Generate the lock into the repo: `/tmp/locktool/bin/uv pip compile --generate-hashes --python-version 3.12 /tmp/fuzz-req.in -o tests/fuzz/requirements.lock`
   You should see a list of packages and the file written. Open it: every package line has a version (`==`) and one or more `--hash=sha256:` lines.
5. Tidy up: `rm -rf /tmp/locktool /tmp/fuzz-req.in`
6. Tell Claude: "fuzz lock generated". Don't commit it yourself; I commit it under QA2 and re-run QA2's check, then security re-reviews.

## Done check
`test -s tests/fuzz/requirements.lock && grep -c -- '--hash=sha256' tests/fuzz/requirements.lock` prints a number above 50. The next fuzz run prints that it installed from the lock.

## If something looks different
- **`uv` won't install / no internet:** use `pip-tools` instead: `/tmp/locktool/bin/pip install pip-tools` then `/tmp/locktool/bin/pip-compile --generate-hashes -o tests/fuzz/requirements.lock /tmp/fuzz-req.in`.
- **`python3 -m venv` says "ensurepip is not available":** install the system package first: `sudo apt install python3.12-venv`, then repeat step 2.
- **You'd rather not:** choose Option B in the Gate 3 packet (accept the risk for test tooling); nothing else changes.
