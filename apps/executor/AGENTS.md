# Executor

- This container executes commands for one trusted development session. Never expose it publicly or mount the Docker socket.
- Preserve process-group termination, output/body limits and single-command admission when changing execution.
- Keep executor credentials separate from API user authentication.
