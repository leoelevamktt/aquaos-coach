/**
 * Prepara os assets locais do motor de pose (MediaPipe Tasks Vision):
 *  1. Copia o WASM do pacote npm para public/pose/wasm (sem binários no git).
 *  2. Baixa o modelo BlazePose "full" para public/pose/models (fallback: CDN).
 *
 * Idempotente e tolerante a falta de rede: em caso de falha apenas avisa e
 * sai com 0 — o app faz fallback para CDN em tempo de execução.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSource = resolve(webRoot, "../..", "node_modules/@mediapipe/tasks-vision/wasm");
const wasmTarget = resolve(webRoot, "public/pose/wasm");
const modelTarget = resolve(webRoot, "public/pose/models/pose_landmarker_full.task");
const modelUrl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

function prepareWasm() {
  if (!existsSync(wasmSource)) {
    console.warn("[vision] Pacote @mediapipe/tasks-vision não encontrado; WASM será servido via CDN.");
    return;
  }
  if (existsSync(resolve(wasmTarget, "vision_wasm_internal.js"))) return;
  mkdirSync(wasmTarget, { recursive: true });
  cpSync(wasmSource, wasmTarget, { recursive: true });
  console.log("[vision] WASM copiado para public/pose/wasm");
}

async function prepareModel() {
  if (existsSync(modelTarget)) return;
  try {
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await mkdirSync(dirname(modelTarget), { recursive: true });
    await writeFile(modelTarget, Buffer.from(await response.arrayBuffer()));
    console.log("[vision] Modelo pose_landmarker_full baixado para public/pose/models");
  } catch (cause) {
    console.warn(`[vision] Download do modelo falhou (${cause.message}); o app usará o CDN em tempo de execução.`);
  }
}

prepareWasm();
await prepareModel();
