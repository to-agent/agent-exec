# SKILL: install agent-exec
# Description: Install and start agent-exec on this machine

## Prompt

Paste this into a local AI coding agent:

```text
Install agent-exec on this machine.

Run:
1. Check that Node.js and npm are available.
2. Install globally:
   npm install -g @to-agent/agent-exec
3. Run:
   aexec setup
4. Start the server:
   aexec start
5. Run:
   aexec share
6. Show me the generated share prompt.

Do not edit project files unless needed.
Do not expose agent-exec to the public internet.
Do not use --public unless I explicitly ask for network access.
Do not add broad ACL rules such as allow "*".
Fresh installs should only allow:
  aexec --version

If any command fails, stop and show me the error plus the next recommended command.
```
