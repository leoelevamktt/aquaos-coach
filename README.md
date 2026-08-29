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

## Gestão de arquivos e análise

Os arquivos ficam em `apps/api/storage/uploads` no desenvolvimento local e no volume persistente da API no Docker. Metadados, CRUD e auditoria ficam em `apps/api/storage/aquaos-data.json` como camada operacional local; o schema PostgreSQL permanece preparado para a homologação multiusuário.

A análise AquaMotion usa diferença temporal de quadros com FFmpeg. Ela gera indicadores objetivos durante a reprodução, mas não substitui a validação técnica do treinador e não deve ser apresentada como visão computacional clínica ou arbitragem automática.

## Importante

O `DemoLoadEngine` é explicitamente demonstrativo. Ele não representa o método proprietário do treinador. Substitua-o apenas depois de receber fórmulas e casos anonimizados e validar os resultados.

Os simuladores não são conexões oficiais. Credenciais Garmin, Polar e HealthKit/WorkoutKit serão integradas em uma etapa de homologação, com endpoints HTTPS e o aplicativo móvel correspondente.
