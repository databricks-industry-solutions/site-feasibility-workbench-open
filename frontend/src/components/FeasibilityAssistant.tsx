import { useState, useRef, useEffect, Dispatch, SetStateAction } from "react";
import { Send, Loader2, Sparkles, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { ChatMessage } from "../pages/WizardApp";

function renderMarkdown(text: string): React.ReactNode {
  const boldRe = /\*{2,3}(.+?)\*{2,3}|\*(.+?)\*/g;
  const parseLine = (line: string, li: number): React.ReactNode[] => {
    const tokens: React.ReactNode[] = [];
    const re = new RegExp(boldRe.source, boldRe.flags);
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > cursor) tokens.push(line.slice(cursor, m.index));
      tokens.push(<strong key={`${li}-${m.index}`}>{m[1] ?? m[2]}</strong>);
      cursor = m.index + m[0].length;
    }
    if (cursor < line.length) tokens.push(line.slice(cursor));
    return tokens;
  };
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {parseLine(line, i)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

const STEP_SUGGESTIONS: Record<number, string[]> = {
  2: [
    "What are typical score thresholds for Phase 3 CNS trials?",
    "What risk tolerance is recommended for rare disease?",
  ],
  3: [
    "Which regions tend to have the highest patient density?",
    "How does competitor trial density impact site viability?",
  ],
  4: [
    "Why might I increase the RWE weight for this protocol?",
    "How does site selection probability affect enrollment?",
  ],
  5: [
    "What does a high enrollment stall risk prediction mean?",
    "Which features most strongly indicate stall risk?",
  ],
  6: [
    "Do we have sufficient capacity for this enrollment target?",
    "Which backup sites should we consider adding?",
  ],
};

interface ChatContext {
  study_id: string | null;
  indication: string | null;
  step: number;
  shortlist_count: number;
  site_count: number | null;
}

interface Props {
  context: ChatContext;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

export default function FeasibilityAssistant({ context, messages, setMessages }: Props) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("feasibility-assistant-collapsed") === "true"; } catch { return false; }
  });

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      try { localStorage.setItem("feasibility-assistant-collapsed", String(!prev)); } catch {}
      return !prev;
    });
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMsgs, context }),
      });
      if (!res.ok) {
        const status = res.status;
        let errMsg = "Sorry, the assistant is unavailable right now. Please try again.";
        if (status === 503) {
          errMsg = "The Genie assistant is not configured. Set GENIE_SPACE_ID in app.yaml (run setup.sh) and redeploy.";
        } else if (status === 500) {
          errMsg = "The Genie assistant returned an error. Check that the Genie Space has been shared with the app service principal and that Databricks Assistant is enabled in your workspace settings.";
        }
        throw new Error(errMsg);
      }
      const data = await res.json();
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.answer },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sorry, the assistant is unavailable right now. Please try again.";
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: msg },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setInput("");
  };

  const suggestions = STEP_SUGGESTIONS[context.step] ?? [];

  return (
    <div className={`flex-shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0 transition-all duration-200 ${isCollapsed ? "w-10" : "w-80"}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-2.5 flex-shrink-0 bg-gray-50 border-b border-gray-200">
        <button
          onClick={toggleCollapse}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded"
          title={isCollapsed ? "Expand assistant" : "Collapse assistant"}
        >
          {isCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {!isCollapsed && (
          <>
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className="flex-shrink-0 opacity-60">
              <path d="M16 2L2 10.5V21.5L16 30L30 21.5V10.5L16 2Z" fill="#FF3621" fillOpacity="0.3"/>
              <path d="M16 6L5 12.5V19.5L16 26L27 19.5V12.5L16 6Z" fill="#FF3621" fillOpacity="0.5"/>
              <path d="M16 10L8 14.5V17.5L16 22L24 17.5V14.5L16 10Z" fill="#FF3621" fillOpacity="0.85"/>
              <circle cx="16" cy="16" r="3" fill="#FF3621"/>
            </svg>
            <span className="text-gray-600 text-sm font-medium tracking-tight">Feasibility Assistant</span>
            <span className="text-gray-400 text-xs ml-0.5">· Genie</span>
            {messages.length > 0 && (
              <button
                onClick={reset}
                className="ml-auto text-gray-400 hover:text-gray-600 transition-colors"
                title="Clear conversation"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* Context chip */}
          {context.indication && (
            <div className="bg-blue-50 border-b border-blue-100 px-4 py-1.5 text-xs text-blue-700 flex-shrink-0">
              {context.indication}
              {context.shortlist_count > 0 && ` · ${context.shortlist_count} shortlisted`}
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 min-h-0">
            {messages.length === 0 ? (
              <div>
                <div className="flex items-start gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-gray-600">
                    Ask about site feasibility, enrollment strategy, score thresholds, or this protocol.
                  </p>
                </div>
                {suggestions.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {suggestions.map(s => (
                      <button
                        key={s}
                        onClick={() => sendMessage(s)}
                        disabled={isLoading}
                        className="text-left text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[92%] rounded-xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-gray-200 text-gray-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      <p className="leading-relaxed">{renderMarkdown(msg.content)}</p>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-xl px-3 py-2 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                      <span className="text-xs text-gray-500">Genie is thinking…</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-gray-200 px-3 py-2.5 flex gap-2 flex-shrink-0 bg-gray-50">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
              placeholder="Ask about this trial…"
              disabled={isLoading}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
                input.trim() && !isLoading
                  ? "bg-gray-600 text-white hover:bg-gray-700"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
