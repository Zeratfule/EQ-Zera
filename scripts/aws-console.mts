/**
 * aws-console.mts — a console sign-in URL for the EQC sub-account, from the CLI.
 *
 *   npx tsx scripts/aws-console.mts [--profile eqc]
 *
 * Resolves the profile's credentials (the `eqc` profile performs the
 * OrganizationAccountAccessRole assumption itself — see ~/.aws/config), exchanges the
 * temporary session for a federation SigninToken, and prints a login URL. The URL is a
 * BEARER SECRET while it lives: anyone holding it gets the console session. It goes to
 * stdout and nowhere else — never into a file, a commit, or a ticket. Valid for the
 * credential session's lifetime (the org role's default: one hour); re-run for a fresh one.
 */
import { fromIni } from '@aws-sdk/credential-providers'

const i = process.argv.indexOf('--profile')
const profile = i === -1 ? 'eqc' : (process.argv[i + 1] ?? 'eqc')

const creds = await fromIni({ profile })()
if (!creds.sessionToken) {
  // Long-lived IAM user keys cannot federate — the endpoint requires a session.
  throw new Error(`profile '${profile}' yielded non-session credentials; the federation endpoint needs an assumed role`)
}

const session = JSON.stringify({
  sessionId: creds.accessKeyId,
  sessionKey: creds.secretAccessKey,
  sessionToken: creds.sessionToken
})
const tokenRes = await fetch(
  `https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=${encodeURIComponent(session)}`
)
if (!tokenRes.ok) throw new Error(`getSigninToken: HTTP ${String(tokenRes.status)}`)
const { SigninToken } = (await tokenRes.json()) as { SigninToken: string }

const dest = encodeURIComponent('https://us-east-1.console.aws.amazon.com/console/home?region=us-east-1')
const url = `https://signin.aws.amazon.com/federation?Action=login&Issuer=eqc-cli&Destination=${dest}&SigninToken=${SigninToken}`
console.log(url)
