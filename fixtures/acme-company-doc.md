# Acme Solutions — Vendor Requirements Brief

**Prepared by:** Priya Nair, Head of Engineering · **Date:** Oct 2026

## Who we are
Acme Solutions is a 28-person London-based B2B SaaS company selling workflow automation to mid-market logistics firms.
Seed + Series A funded (£6M raised). 14 engineers. Two enterprise prospects (a UK retailer and a Dutch freight group) have
told us a SOC 2 Type II report is required before they sign. We have no compliance staff.

## What we need
A **SOC 2 compliance automation platform** (continuous control monitoring, evidence collection, policy templates, auditor access)
so we can reach audit-ready within **90 days** and complete a Type II observation period.

## Our current stack
AWS (eu-west-2, ECS + RDS Postgres), GitHub (org-wide, branch protection), Okta (SSO/MFA), Linear, Slack, Google Workspace,
Datadog, Terraform.

## Hard requirements (dealbreakers)
1. **Total annual cost under £15,000** (platform + first-year audit if bundled; tell us if the audit is extra).
2. **Customer data and evidence stored in UK or EU** (our enterprise customers' DPAs require it).
3. **Native integrations** with AWS, GitHub and Okta (no "custom connector" workarounds).
4. **Supports SOC 2 Type II**, not only Type I.
5. Must not require a sales call just to learn pricing structure — we need ballpark public numbers.

## Preferences (nice to have)
- Built-in or partnered auditor marketplace (UK-friendly auditors)
- Also covers ISO 27001 later
- Slack alerts for failing controls
- Strong support reputation among startups of our size
- Terraform provider / API access

## What "good" looks like
A ranked shortlist of 3 or fewer vendors, each with verified evidence for every hard requirement, the vendors we should
**rule out and why**, and a first email we can send to the top pick to book a demo.

## Out of scope
Penetration testing providers, GRC platforms aimed at enterprises (>500 staff), anything requiring on-prem deployment.
