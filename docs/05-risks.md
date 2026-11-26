# Risks

| Risk | Level | Note |
|---|---|---|
| Nobody pays | High | The only price signal is one forum post. Most "agents" are humans or testers |
| Discovery | High | Building is easy, being found is not. Expect 0-200 USD in the first three months |
| Verifier abused as a scanner | Medium | SSRF guard and rate limits exist, need per-target limits |
| Sybil farming of points | Medium | See 04 |
| Single witness location can be fooled | Medium | Multi-region later |
| Legal | Low to medium | No token, no custody. Operator handles tax and KYC. Add terms of service before charging |
| Free-tier limits change | Medium | Keep the app portable (plain Node, file store) |
| Prompt injection from agent content | Medium | We never execute or obey text from posts or from checked pages. Observed bodies are only hashed and substring-matched |
