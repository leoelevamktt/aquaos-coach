"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X, MessageCircle } from "lucide-react";
import { API_URL, apiRequest } from "./api";

type ChatMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Como está a prontidão da equipe hoje?",
  "Qual atleta está mais perto da meta?",
  "Resuma a semana de treinos",
  "Quem preciso monitorar de perto?",
  "Como está a fila de vídeos?",
  "Como está o volume da equipe?",
];

function renderContent(content: string) {
  // Markdown leve: **negrito**, listas com "- " e quebras de linha
  const blocks = content.split("\n").filter((line) => line.trim().length > 0);
  return blocks.map((line, index) => {
    const isBullet = /^[-•*]\s+/.test(line);
    const text = line.replace(/^[-•*]\s+/, "");
    const parts = text.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={partIndex}>{part.slice(2, -2)}</strong>
        : <span key={partIndex}>{part}</span>
    );
    return isBullet
      ? <li key={index} className="chat-bullet">{parts}</li>
      : <p key={index}>{parts}</p>;
  });
}

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (available !== null || !open) return;
    apiRequest<{ available: boolean }>("/api/v1/ai/status")
      .then((status) => setAvailable(status.available))
      .catch(() => setAvailable(false));
  }, [open, available]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const response = await apiRequest<{ reply: string }>("/api/v1/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      setMessages((current) => [...current, { role: "assistant", content: response.reply }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar o assistente";
      setMessages((current) => [...current, { role: "assistant", content: `**Erro:** ${message}` }]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Abrir assistente de IA">
        <Sparkles size={20} />
      </button>
    );
  }

  return (
    <>
      <div className="ai-panel" role="dialog" aria-label="Assistente de IA">
        <header className="ai-panel-head">
          <div className="ai-panel-title">
            <span className="ai-panel-badge"><Bot size={17} /></span>
            <div>
              <strong>Assistente AquaOS</strong>
              <small>{available === false ? "offline" : "conectado aos dados da plataforma"}</small>
            </div>
          </div>
          <button className="ai-panel-close" onClick={() => setOpen(false)} aria-label="Fechar assistente"><X size={18} /></button>
        </header>

        <div className="ai-panel-body" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="ai-welcome">
              <span className="ai-welcome-icon"><MessageCircle size={22} /></span>
              <strong>Pergunte qualquer coisa da plataforma</strong>
              <p>Atletas, treinos, metas, competições, vídeos, prontidão, volumes e auditoria — eu leio tudo em tempo real.</p>
              <div className="ai-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`ai-msg ${message.role}`}>
              {message.role === "assistant" && <span className="ai-msg-avatar"><Bot size={14} /></span>}
              <div className="ai-msg-content">{renderContent(message.content)}</div>
            </div>
          ))}
          {loading && (
            <div className="ai-msg assistant">
              <span className="ai-msg-avatar"><Bot size={14} /></span>
              <div className="ai-msg-content ai-typing"><i /><i /><i /></div>
            </div>
          )}
        </div>

        <form
          className="ai-panel-input"
          onSubmit={(event) => { event.preventDefault(); void send(); }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={available === false ? "Assistente indisponível — configure LLM_API_KEY" : "Pergunte sobre atletas, treinos, metas…"}
            aria-label="Mensagem para o assistente"
            disabled={available === false}
          />
          <button type="submit" disabled={!input.trim() || loading} aria-label="Enviar mensagem"><Send size={16} /></button>
        </form>
      </div>
    </>
  );
}
