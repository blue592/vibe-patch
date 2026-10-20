# Security notes

Do not include real API keys or private source files in public issues. This project has no dedicated private reporting channel yet. Describe general reproduction steps without secrets, or contact the repository owner privately using a channel they explicitly publish.

Only selected files are sent to the chosen provider; the tool is not a secret scanner. Local proposals and backup journals contain source code. Protect and ignore `.vibepatch/` and private `.env` files.

Generated files may contain unsafe code. Review them before applying or running anything. The tool does not execute generated commands. Filesystem checks are intended for a single-user local project and do not provide isolation against malicious concurrent directory changes. Back up your project using Git.
