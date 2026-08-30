# AquaOS Coach

Plataforma operacional para prescrição, gestão e inteligência de uma seleção de natação.

## Rodar com Docker

Pré-requisito: Docker Desktop.

```bash
docker compose up --build
```

Abra [http://localhost:3000](http://localhost:3000). A API fica em [http://localhost:4000](http://localhost:4000) e a especificação OpenAPI em [http://localhost:4000/api/v1/openapi.json](http://localhost:4000/api/v1/openapi.json).

## Rodar sem Docker

Pré-requisito: Node.js 22+ (Node 20+ também deve funcionar) e npm.

```bash
npm install
npm run dev
```

O frontend usa o backend em `http://localhost:4000`. Para apontar para outro ambiente, defina `NEXT_PUBLIC_API_URL`.

## O que já está funcional

- Dashboard premium do treinador, responsivo/PWA, com agenda, readiness, carga, presença e decisões priorizadas.
- Central de gestão persistente com criação, visualização, edição, exclusão e auditoria de atletas, grupos, treinos, temporadas, competições, vídeos, documentos, comissão, zonas, metas, atividades e parâmetros.
- Upload real de vídeo, documentos, imagens e planilhas, com limite de 500 MB por arquivo.
- Importação CSV/JSON para cadastros e decodificação FIT pelo SDK oficial da Garmin.
- Dois vídeos técnicos carregados, streaming com suporte a `Range`, miniaturas e análise AquaMotion sincronizada à reprodução.
- Métricas de vídeo: curva de movimento, ciclos detectados, cadência estimada, consistência rítmica, índice técnico, eventos automáticos e marcações manuais.
- Editor conversacional de treino com foto/documento, estruturação, publicação persistente e atribuição.
- Temporadas, mesociclos, competições, índices, inscrições, modo deck e documentos de competição.
- Calendário, biblioteca de natação/força, prontuário longitudinal e analytics do programa.
- Check-in e registro de execução pela API, com cálculo demo versionado.
- Prescrições por equipe/grupo/atleta no domínio e versionamento de sessão.
- Simuladores Garmin, Polar e Apple com importação e envio conforme a matriz de capacidades.
- Idempotência por `externalId` e armazenamento do payload bruto no modelo.
- PostgreSQL com schema inicial e armazenamento persistente de mídia/metadados no volume `natacao_api_storage`.
- Biblioteca RKF V5.1 integrada ao motor de planejamento: as 910 sessões / 6.226 blocos da seed são carregadas em `GET /api/v1/rkf/sessions` (filtros por zona, faixa de idade, perfil, tipo e volume) e alimentam o pipeline eligible → scored → candidate → audited em `POST /api/v1/rkf/sessions/compose`, com fallback de recomposição determinística quando o candidato da biblioteca reprova na auditoria.
- Pipeline de evolução ponta a ponta: `POST /api/v1/rkf/evolution/assess-set` calcula score composto (0,45 tempo + 0,20 consistência + 0,15 fadiga + 0,20 eficiência) e delta percentual a partir do histórico por chave comparável de 8 partes, e `GET /api/v1/rkf/evolution/athletes/:id` consolida as avaliações do atleta. Menos de 3 comparáveis retorna `DADOS_INSUFICIENTES`.
- Decisões de adaptação persistidas com versão, guardrails e trilha de auditoria em `POST /api/v1/rkf/readiness/adapt`.
- Ingestão multicanal real: `POST /api/v1/rkf/ingestions` aceita JSON (canal TEXT com parser RKF automático — zonas, volumes, materiais, RP→marcador RDC) e multipart (canais PHOTO/FILE/VOICE com extração documental via PDF/DOCX/XLSX/CSV/TXT e pipeline RECEIVED→STORED→EXTRACTED→PARSED→REVIEW). Confiança <0,85 exige revisão humana; nada é inventado.
- PDF da prescrição publicada (`GET /api/v1/rkf/prescriptions/:id.pdf`) com blocos, zonas, volumes, versões do motor e hash SHA-256 — somente após aprovação do coach.
- Tenant isolation sem allowlists literais: acesso de atleta validado exclusivamente pelo `athleteId` da sessão autenticada.
- Catálogo auditável da seed: os dez arquivos e 15.246 linhas podem ser consultados com paginação, busca, hash SHA-256, colunas, finalidade e estado de ativação; dados preservados ainda não operacionalizados permanecem explicitamente em revisão.
- Registro formal das 12 decisões metodológicas pendentes, com evidências, responsável, revisão otimista e bloqueio de release quando uma decisão crítica não está homologada.

## Gestão de arquivos e análise

Os arquivos ficam em `apps/api/storage/uploads` no desenvolvimento local e no volume persistente da API no Docker. Metadados, CRUD e auditoria ficam em `apps/api/storage/aquaos-data.json` como camada operacional local; o schema PostgreSQL permanece preparado para a homologação multiusuário.

A análise AquaMotion usa diferença temporal de quadros com FFmpeg. Ela gera indicadores objetivos durante a reprodução, mas não substitui a validação técnica do treinador e não deve ser apresentada como visão computacional clínica ou arbitragem automática.

## Importante

O `DemoLoadEngine` é explicitamente demonstrativo. Ele não representa o método proprietário do treinador. Substitua-o apenas depois de receber fórmulas e casos anonimizados e validar os resultados.

Os simuladores não são conexões oficiais. Credenciais Garmin, Polar e HealthKit/WorkoutKit serão integradas em uma etapa de homologação, com endpoints HTTPS e o aplicativo móvel correspondente.
