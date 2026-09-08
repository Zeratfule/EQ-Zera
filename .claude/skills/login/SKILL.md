---
name: login
description: Mint a federated AWS console sign-in link for the eqcompanion sub-account from the local CLI credentials — no prior browser sign-in needed. Use when the owner asks for an AWS login link, console access, or a federated link, optionally naming a destination page (billing, cost, lambda, a service console).
---

# Federated AWS console login

Turns the machine's `eqc` CLI credentials into a clickable console URL that
signs the owner straight into the **eqcompanion sub-account (001634075447)**
with no password and no prior session. Proven flow, 2026-08-12/13.

## The procedure

One Bash call (Git Bash; node is available):

```bash
creds=$(aws configure export-credentials --profile eqc 2>/dev/null) && node -e "
const c=JSON.parse(process.argv[1]);
const session=JSON.stringify({sessionId:c.AccessKeyId,sessionKey:c.SecretAccessKey,sessionToken:c.SessionToken});
fetch('https://signin.aws.amazon.com/federation?Action=getSigninToken&Session='+encodeURIComponent(session))
 .then(r=>r.json())
 .then(j=>{
   const url='https://signin.aws.amazon.com/federation?Action=login&Issuer=eqc-cli&Destination='+encodeURIComponent(process.argv[2])+'&SigninToken='+j.SigninToken;
   console.log(url);
 }).catch(e=>console.error('federation failed:',e.message));
" "$creds" "https://us-east-1.console.aws.amazon.com/console/home?region=us-east-1"
```

- The last argument is the **destination page**. Pick it from what the owner
  asked for: console home (above), Cost Management
  (`https://us-east-1.console.aws.amazon.com/costmanagement/home?region=us-east-1#/home`),
  or any service console URL. Region is us-east-1 for everything in this
  account.
- Present the result as a markdown link, and say the validity plainly: the
  link works for about **1 hour** (the remaining lifetime of the assumed-role
  session), single account, no password involved.
- If this CLI version rejects `export-credentials` with a `--format` error,
  call it with no `--format` flag (JSON is the default on the installed v2);
  the older env-format fallback is in the session history of 2026-08-12 if
  ever needed.

## Why this works, and its one hard boundary

The `eqc` profile assumes `OrganizationAccountAccessRole` in the sub-account
from the `windows-desktop-eqc` IAM user key (the only long-term key on this
machine). Assumed-role credentials are accepted directly by AWS's federation
endpoint — no extra permission needed.

**The PARENT / payer account (383185690517) is NOT reachable from this
machine, by design.** The desktop key is scoped to exactly one action (assume
the org role in the sub-account); it was verified 2026-08-12 that it cannot
call `sts:GetFederationToken`, cannot read or edit IAM, and has no role in the
parent to assume. Do not retry those calls. If the owner wants CLI-mintable
parent links, they must first — while logged into the parent normally —
attach this inline policy to the `windows-desktop-eqc` user:

```json
{ "Version": "2012-10-17", "Statement": [{ "Effect": "Allow", "Action": "sts:GetFederationToken", "Resource": "*" }] }
```

After that, parent links mint with `aws sts get-federation-token --name josh
--policy-arns arn=arn:aws:iam::aws:policy/AdministratorAccess
--duration-seconds 43200 --profile windows-desktop-eqc`, feeding those
credentials through the same getSigninToken flow (those links last 12 hours).

## Safety rails

- Never print or persist the raw credentials — only the finished sign-in URL
  ever leaves the shell pipeline.
- The URL embeds a bearer token: it belongs in the owner's chat and nowhere
  else (no tickets, no commits, no logs).
- Billing pages are read-only surfaces for this role; nothing about this flow
  performs financial actions.
