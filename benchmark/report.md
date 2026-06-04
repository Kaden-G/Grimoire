# Grimoire Token Savings

- **Repo:** `C:\Users\N7246G\Documents\Grimoire` (30 source files, 52 map entries)
- **Token counter:** tiktoken cl100k_base
- **Map source:** heuristic scan (no AI)

## Orientation (understanding the repo)

| Scenario | Tokens |
|---|---:|
| Read the whole repo source | 105,871 |
| Read the Grimoire map | 681 |
| **Savings** | **99.4% (155x fewer)** |

## Per task (read top 5 candidate files vs map → read 1 file)

| Question | Without Grimoire | With Grimoire | Saved |
|---|---:|---:|---:|
| auth | 38,715 | 8 | 100.0% (4839x) |
| database | 38,956 | 8 | 100.0% (4870x) |
| api | 32,431 | 8 | 100.0% (4054x) |
| config | 50,205 | 68 | 99.9% (738x) |
| test | 44,466 | 1,056 | 97.6% (42x) |
| state | 48,762 | 8 | 100.0% (6095x) |
