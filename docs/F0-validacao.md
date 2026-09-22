# F0 — Validação técnica (22/09/2026, ~21h–22h, IP residencial NOS)

## OLX (olx.pt)
- `GET /api/v1/offers/` com Node `fetch` ou curl → **403** (CloudFront bloqueia a "impressão digital" do cliente).
- **Playwright + Edge instalado (`channel: "msedge"`, headless) + `fetch` dentro da página → 200.** 5/5 pedidos, 0,5–0,9 s, ~160–240 KB cada. Não é preciso descarregar o Chromium no Windows.
- `sort_by=created_at:desc` ordena por **última atualização** (`last_refresh_time`), com anúncios **promovidos** injetados no topo (`promotion.top_ad`). → Dedup por `id` e carregamento inicial silencioso quando se cria uma pesquisa nova.
- Campos úteis: `id, url, title, description, created_time, last_refresh_time, pushup_time, params[key=price].value.value, location.city/region, user.id, business, photos, category.id`.
- Nomes das categorias via `/api/v1/offers/metadata/search/?category_id=X&facets=[{"field":"category_without_exclusions","fetchLabel":true}]`.

| id | Categoria | Total de anúncios | Entrada (terça, ~21h) |
|---|---|---|---|
| 240 | Computadores – Informática (pai) | 90 843 | — |
| **5371** | Componentes e Peças | 20 031 | ~37/h |
| **4731** | Computadores | 7 738 | ~17/h |
| **4753** | Portáteis | 11 808 | ~17/h |
| 4745 / 4751 / 5370 | Monitores / Periféricos / Acessórios | — | — |

→ Uma página (limit 50) cobre mais de 1 hora por categoria. **Firehose: 3 categorias a cada 2 min ≈ 1,5 pedidos/min**, mais pesquisas por termo em todo o OLX em rotação.

## Vinted (vinted.pt)
- `/api/v2/catalog/items` → **404 (retirada)**, até no browser.
- `GET /catalog?order=newest_first&catalog[]=…` com Node `fetch` simples → **200**, ~1,1–1,6 s, ~750 KB comprimidos. Traz **96 anúncios** no *flight data* do Next.js (`self.__next_f.push`), em objetos `productItem`: `id, title, url, price.amount, totalItemPrice.amount, itemBox.firstLine (marca), itemBox.secondLine (estado), user.id, user.isBusiness, photos`. **Não traz data nem país.**
- **Várias categorias num só pedido funciona** (`catalog[]=3582&catalog[]=3581&catalog[]=3580` → 96 anúncios misturados).
- Árvore: 3564 Computadores e acessórios → **3580** Portáteis, **3581** Secretária, **3582** Peças e componentes (3598 caixas, 3599 CPU, 3600 motherboards, 3601 combos, **3602 placas gráficas**, 3603 RAM, 3604 refrigeração, 3607 armazenamento, 3608 fontes…).
- Novos por ~70 s (UE inteira): 3602 → 1–2, 3580 → 1–3, 3581 → 0, 3564 (inteira) → 14–21. **As 3 categorias juntas: ~5–10/min, bem abaixo dos 96 por página.**
- A Vinted PT mostra anúncios de toda a UE (FR/IT/NL/ES). **O país vem de `/api/v2/users/{id}` (esta API ainda responde, com cookie de sessão anónima): `country_code`, `city`.** A descrição vem da página `/items/{id}` (~2 MB). `/api/v2/items/{id}/details` → 403.
- → **Firehose: 1 pedido multi-categoria a cada ~30 s (≈ 2 pedidos/min) cobre tudo com folga.** Enriquecimento (país + descrição) só para candidatos, com o país do vendedor em cache.

## Parâmetros iniciais para a F2
| Fonte | Firehose | Pesquisas por termo | Enriquecimento |
|---|---|---|---|
| Vinted | multi-categoria 3582+3581+3580, **30 s ± 20 %** | rotação de 1 termo a cada ~60 s | `users/{id}` (cache) + `/items/{id}` só para candidatos |
| OLX | 5371, 4731, 4753 a cada **2 min ± 20 %** | rotação de ~2 termos/min em todo o OLX | não é preciso (a API já traz a descrição) |

## Nota sobre o "ritmo de bloqueio"
Não forcei ritmos altos para descobrir o limite, para não arriscar o IP. Os ritmos planeados (~2–4 pedidos/min por fonte) são próximos de uma pessoa a navegar. O worker terá backoff em 403/429 e pausa automática. O limite real mede-se em produção, pelo log de pesquisas.

## Fixtures (para testes)
`apps/worker/fixtures/olx-offers.json` (resposta real) e `apps/worker/fixtures/vinted-catalog.html` (10 anúncios reais no formato flight). Regenerar com `npx tsx spikes/make-fixtures.ts`.
