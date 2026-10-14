# Investor portal — design only

No external auth, schema, role or public endpoint is implemented or activated.
Owner approval of this contract is required before implementation.

| Concern | Proposed contract |
| --- | --- |
| Identity | Explicit verified external subject → canonical Investor mapping, approved by an internal Portfolio owner. Never infer access from matching email alone. |
| Authorization | External portal principals cannot become app members or inherit member permissions. Require active mapping on every request, including downloads. |
| Positions | Show only the mapped Investor's positions in permitted SPVs, with approved disclosure fields. Exclude other investors' amounts and internal notes. |
| Documents | Explicit Investor→SPV→document disclosure allowlist, not all files of a company, fund or vehicle. No raw Drive URLs. |
| Downloads | Short-lived signed links issued after the mapping/disclosure check; confidential responses must not enter public caches. |
| Lifecycle | Expiring grants, immediate mapping revocation, renewed sessions, separate invitation acceptance, audited owner changes and downloads. |
| Audit | Record actor, Investor and resource references, outcome and time; exclude token material, document contents and private mailbox data. |
| Acceptance | Cross-Investor and cross-SPV deny tests, inactive/expired grants, revoked-session/download handling and disclosure review. |

Open decisions: identity provider, invitation approver, exact disclosed fields,
SPV disclosure owner, expiry periods and whether existing links require proxying
for immediate revocation. Until resolved, use current internal protected views.
