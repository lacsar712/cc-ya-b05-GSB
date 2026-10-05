import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

type Briefing = {
  id: number;
  generated_by: string;
  generated_at: string;
  pass_count: number;
  fail_count: number;
  pending_count: number;
  recent_done: Array<{
    turbine_code: string;
    yaw_err_deg: number;
    verdict: string;
    processed_at: string | null;
  }>;
  body: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type Page = "logs" | "briefings";

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    .topbar {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .topbar .spacer {
      flex: 1;
    }
    button.nav {
      background: #334155;
    }
    button.nav.active {
      background: #0284c7;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .neutral {
      background: #334155;
      color: #e2e8f0;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .brief-layout {
      display: grid;
      grid-template-columns: minmax(240px, 1fr) 1.4fr;
      gap: 1rem;
      align-items: start;
    }
    @media (max-width: 720px) {
      .brief-layout {
        grid-template-columns: 1fr;
      }
    }
    ul.history {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ul.history li button.item {
      width: 100%;
      text-align: left;
      background: #0f172a;
      border: 1px solid #334155;
      margin-bottom: 0.5rem;
      font-weight: 400;
      line-height: 1.5;
    }
    ul.history li button.item.active {
      border-color: #38bdf8;
      background: #12324a;
    }
    ul.history .meta {
      font-size: 0.78rem;
      color: #94a3b8;
    }
    pre.body {
      white-space: pre-wrap;
      word-break: break-word;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.75rem;
      margin: 0.75rem 0 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 0.88rem;
      line-height: 1.6;
    }
    .statline {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.85rem;
    }
  `;

  @state() private session: Session | null = null;
  @state() private logs: LogRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  @state() private page: Page = "logs";
  @state() private briefings: Briefing[] = [];
  @state() private selectedBriefing: Briefing | null = null;
  @state() private briefLoading = false;
  @state() private briefError = "";

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshLogs();
        this._pollTimer = window.setInterval(() => void this.refreshLogs(), 2000);
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _pollTimer?: number;

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async refreshLogs() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/logs", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.logs = (await res.json()) as LogRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      this.page = "logs";
      await this.refreshLogs();
      this._pollTimer = window.setInterval(() => void this.refreshLogs(), 2000);
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.briefings = [];
    this.selectedBriefing = null;
    this.page = "logs";
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async submitLog() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "提交失败";
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      await this.refreshLogs();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  // ---- 交班签出简报 ----

  private async switchPage(page: Page) {
    this.page = page;
    if (page === "briefings") {
      await this.refreshBriefings();
    }
  }

  private async refreshBriefings() {
    if (!this.session) return;
    this.briefLoading = true;
    this.briefError = "";
    try {
      const res = await fetch("/api/briefings", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.briefError = data.detail || "读取历史简报失败";
        return;
      }
      this.briefings = (await res.json()) as Briefing[];
      // 当前预览若仍存在于历史中则保持不动（旧简报内容永不随在线变化刷新）；
      // 已被删除等情况下清空预览。
      if (
        this.selectedBriefing &&
        !this.briefings.some((b) => b.id === this.selectedBriefing!.id)
      ) {
        this.selectedBriefing = null;
      }
    } catch {
      this.briefError = "读取历史简报时网络异常";
    } finally {
      this.briefLoading = false;
    }
  }

  private async openBriefing(id: number) {
    this.briefError = "";
    try {
      // 打开的是后端按 id 取回的、生成瞬间已冻结的正文，而非现算统计。
      const res = await fetch(`/api/briefings/${id}`, {
        headers: this.authHeaders(),
      });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.briefError = data.detail || "打开简报失败";
        return;
      }
      this.selectedBriefing = (await res.json()) as Briefing;
    } catch {
      this.briefError = "打开简报时网络异常";
    }
  }

  private async generateBriefing() {
    this.briefError = "";
    this.briefLoading = true;
    try {
      const res = await fetch("/api/briefings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
      });
      const data = await res.json();
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) {
        this.briefError = data.detail || "生成简报失败";
        return;
      }
      const created = data as Briefing;
      await this.refreshBriefings();
      // 预览直接展示后端落库后回传的冻结正文，不再二次现算。
      this.selectedBriefing = created;
    } catch {
      this.briefError = "生成简报时网络异常";
    } finally {
      this.briefLoading = false;
    }
  }

  private formatTime(iso: string) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN");
  }

  private renderBriefings() {
    return html`
      <section>
        <div class="row-actions">
          <h2 style="margin:0;font-size:1.1rem;">交班签出简报</h2>
          <div style="flex:1"></div>
          <button
            class="secondary"
            ?disabled=${this.briefLoading}
            @click=${this.refreshBriefings}
          >
            刷新历史
          </button>
          ${this.isWriter
            ? html`
                <button
                  ?disabled=${this.briefLoading}
                  @click=${this.generateBriefing}
                >
                  ${this.briefLoading ? "处理中…" : "生成简报"}
                </button>
              `
            : html`
                <span class="hint">观察员只能查阅已生成的旧简报</span>
              `}
        </div>
        ${this.briefError ? html`<p class="err">${this.briefError}</p>` : null}
      </section>

      <div class="brief-layout">
        <section>
          <h3 style="margin:0 0 0.75rem;font-size:0.95rem;">历史简报</h3>
          ${this.briefings.length === 0
            ? html`<p class="hint">暂无已生成的简报。</p>`
            : html`
                <ul class="history">
                  ${this.briefings.map(
                    (b) => html`
                      <li>
                        <button
                          class="item ${this.selectedBriefing?.id === b.id
                            ? "active"
                            : ""}"
                          @click=${() => this.openBriefing(b.id)}
                        >
                          <strong>#${b.id}　${this.formatTime(b.generated_at)}</strong>
                          <br />
                          <span class="meta">
                            生成人：${b.generated_by}　合格 ${b.pass_count} /
                            超差 ${b.fail_count} / 待处理 ${b.pending_count}
                          </span>
                        </button>
                      </li>
                    `
                  )}
                </ul>
              `}
        </section>

        <section>
          <h3 style="margin:0;font-size:0.95rem;">简报正文预览</h3>
          ${this.selectedBriefing
            ? html`
                <p class="hint" style="margin:0.35rem 0 0;">
                  #${this.selectedBriefing.id} 正文为生成瞬间冻结，之后数据变化不影响本份简报。
                </p>
                <div class="statline">
                  <span class="tag ok">合格 ${this.selectedBriefing.pass_count}</span>
                  <span class="tag bad">偏航超差 ${this.selectedBriefing.fail_count}</span>
                  <span class="tag pending">待处理 ${this.selectedBriefing.pending_count}</span>
                  <span class="tag neutral">
                    ${this.formatTime(this.selectedBriefing.generated_at)}
                  </span>
                </div>
                <pre class="body">${this.selectedBriefing.body}</pre>
              `
            : html`
                <p class="hint">
                  从左侧历史中选择一份简报查看正文；
                  ${this.isWriter
                    ? "或点击右上角「生成简报」生成并冻结当前统计。"
                    : "历史简报均为技师生成时的冻结快照。"}
                </p>
              `}
        </section>
      </div>
    `;
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    return html`
      <h1>风机偏航对中台</h1>
      <p class="sub">
        已登录：${this.session.username}
        (${this.isWriter ? "可提交" : "只读"})
      </p>
      <section class="topbar">
        <button
          class="nav ${this.page === "logs" ? "active" : ""}"
          @click=${() => this.switchPage("logs")}
        >
          对中记录
        </button>
        <button
          class="nav ${this.page === "briefings" ? "active" : ""}"
          @click=${() => this.switchPage("briefings")}
        >
          交班签出简报
        </button>
        <div class="spacer"></div>
        <button class="secondary" @click=${this.logout}>退出</button>
      </section>

      ${this.page === "briefings"
        ? this.renderBriefings()
        : html`
            ${this.isWriter
              ? html`
                  <section>
                    <h2 style="margin-top:0;font-size:1.1rem;">提交偏航记录</h2>
                    <label>机组编号</label>
                    <input
                      placeholder="例如 W12"
                      .value=${this.turbineCode}
                      @input=${(e: Event) =>
                        (this.turbineCode = (e.target as HTMLInputElement).value)}
                    />
                    <label>偏航误差（度，可正可负）</label>
                    <input
                      type="number"
                      step="0.1"
                      .value=${this.yawErr}
                      @input=${(e: Event) =>
                        (this.yawErr = (e.target as HTMLInputElement).value)}
                    />
                    <button ?disabled=${this.loading} @click=${this.submitLog}>
                      提交（进入待认领队列）
                    </button>
                    ${this.error ? html`<p class="err">${this.error}</p>` : null}
                  </section>
                `
              : null}

            <section>
              <div class="row-actions" style="margin-bottom:0.5rem;">
                <h2 style="margin:0;font-size:1.1rem;">对中记录</h2>
                <div style="flex:1"></div>
                <button
                  class="secondary"
                  ?disabled=${this.loading}
                  @click=${this.refreshLogs}
                >
                  刷新列表
                </button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>机组</th>
                    <th>误差°</th>
                    <th>状态</th>
                    <th>结论</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.logs.map(
                    (row) => html`
                      <tr>
                        <td>${row.id}</td>
                        <td>${row.turbine_code}</td>
                        <td>${row.yaw_err_deg}</td>
                      <td>
                        <span
                          class="tag ${row.status === "pending" ? "pending" : "ok"}"
                        >
                          ${row.status === "pending" ? "待处理" : "已完成"}
                        </span>
                      </td>
                      <td>
                        ${row.verdict
                          ? html`<span class="tag ${this.verdictClass(row)}"
                              >${row.verdict}</span
                            >`
                          : "—"}
                      </td>
                      <td>${row.reason ?? "—"}</td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </section>
        `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
