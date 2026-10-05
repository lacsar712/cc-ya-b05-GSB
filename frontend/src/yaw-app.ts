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

type Session = {
  token: string;
  username: string;
  role: string;
};

type RecentDone = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  verdict: string;
  reason: string;
  created_by: string;
  processed_at: string;
};

type Briefing = {
  id: number;
  created_by: string;
  created_at: string;
  pending_count: number;
  ok_count: number;
  over_count: number;
  recent_done: RecentDone[];
  body: string;
};

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
    nav.tabs {
      display: flex;
      gap: 0.25rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid #334155;
    }
    nav.tabs button {
      background: transparent;
      color: #94a3b8;
      border-radius: 6px 6px 0 0;
      border: 1px solid transparent;
      border-bottom: none;
      font-weight: 500;
    }
    nav.tabs button.active {
      background: #1e293b;
      color: #38bdf8;
      border-color: #334155;
    }
    .briefing-layout {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 1rem;
    }
    @media (max-width: 640px) {
      .briefing-layout {
        grid-template-columns: 1fr;
      }
    }
    ul.briefing-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ul.briefing-list li {
      padding: 0.5rem 0.6rem;
      border: 1px solid #334155;
      border-radius: 6px;
      margin-bottom: 0.5rem;
      cursor: pointer;
      background: #0f172a;
    }
    ul.briefing-list li.active {
      border-color: #38bdf8;
    }
    ul.briefing-list li .meta {
      font-size: 0.75rem;
      color: #94a3b8;
      margin-top: 0.15rem;
    }
    .counts {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
    .counts span {
      font-size: 0.72rem;
      padding: 0.05rem 0.4rem;
      border-radius: 4px;
      background: #1e293b;
    }
    pre.briefing-body {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
      font-size: 0.9rem;
      line-height: 1.6;
      margin: 0.5rem 0 0;
      color: #e2e8f0;
    }
    .muted {
      color: #94a3b8;
    }
  `;

  @state() private session: Session | null = null;
  @state() private logs: LogRow[] = [];
  @state() private tab: "logs" | "briefings" = "logs";
  @state() private briefings: Briefing[] = [];
  @state() private selectedBriefing: Briefing | null = null;
  @state() private briefingLoading = false;
  @state() private briefingError = "";
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

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
      this.tab = "logs";
      this.briefings = [];
      this.selectedBriefing = null;
      this.briefingError = "";
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
    this.tab = "logs";
    this.briefings = [];
    this.selectedBriefing = null;
    this.briefingError = "";
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

  private fmtTime(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString("zh-CN", { hour12: false });
  }

  private async switchTab(tab: "logs" | "briefings") {
    this.tab = tab;
    if (tab === "briefings") {
      await this.refreshBriefings();
    }
  }

  private async refreshBriefings() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/briefings", {
        headers: this.authHeaders(),
      });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      const rows = (await res.json()) as Briefing[];
      this.briefings = rows;
      // 历史列表行与详情同源（均为落库冻结正文）；选中项按 id 同步，不做重算。
      if (this.selectedBriefing) {
        const fresh = rows.find((b) => b.id === this.selectedBriefing!.id);
        if (fresh) this.selectedBriefing = fresh;
      }
    } catch {
      /* ignore transient network errors */
    }
  }

  private async selectBriefing(id: number) {
    // 打开旧简报：从后端取生成时落库的冻结行，不据当前列表重算。
    try {
      const res = await fetch(`/api/briefings/${id}`, {
        headers: this.authHeaders(),
      });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) {
        this.briefingError = "读取简报失败";
        return;
      }
      this.selectedBriefing = (await res.json()) as Briefing;
    } catch {
      this.briefingError = "读取简报时网络异常";
    }
  }

  private async generateBriefing() {
    this.briefingError = "";
    this.briefingLoading = true;
    try {
      const res = await fetch("/api/briefings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        this.briefingError = data.detail || "生成简报失败";
        return;
      }
      const briefing = data as Briefing;
      // 直接展示后端落库后返回的冻结行，而不是用当前列表数据临时拼预览。
      this.briefings = [briefing, ...this.briefings];
      this.selectedBriefing = briefing;
    } catch {
      this.briefingError = "生成简报时网络异常";
    } finally {
      this.briefingLoading = false;
    }
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
      <section>
        <div class="row-actions">
          <button class="secondary" @click=${this.logout}>退出</button>
          <button class="secondary" ?disabled=${this.loading} @click=${this.refreshLogs}>
            刷新列表
          </button>
        </div>
      </section>

      <nav class="tabs">
        <button
          class=${this.tab === "logs" ? "active" : ""}
          @click=${() => this.switchTab("logs")}
        >
          对中记录
        </button>
        <button
          class=${this.tab === "briefings" ? "active" : ""}
          @click=${() => this.switchTab("briefings")}
        >
          交班简报
        </button>
      </nav>

      ${this.tab === "briefings"
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
        <h2 style="margin-top:0;font-size:1.1rem;">对中记录</h2>
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
                    <span class="tag ${row.status === "pending" ? "pending" : "ok"}">
                      ${row.status === "pending" ? "待处理" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}">${row.verdict}</span>`
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

  private renderBriefings() {
    return html`
      <section>
        <div class="row-actions">
          ${this.isWriter
            ? html`
                <button
                  ?disabled=${this.briefingLoading}
                  @click=${this.generateBriefing}
                >
                  生成交班简报
                </button>
              `
            : html`<span class="muted">只读账号可查看历史简报，不能生成。</span>`}
          <button class="secondary" @click=${this.refreshBriefings}>
            刷新历史
          </button>
        </div>
        ${this.briefingError
          ? html`<p class="err">${this.briefingError}</p>`
          : null}
      </section>

      <section>
        <div class="briefing-layout">
          <div>
            <h2 style="margin-top:0;font-size:1rem;">历史简报</h2>
            ${this.briefings.length === 0
              ? html`<p class="muted">暂无简报</p>`
              : html`
                  <ul class="briefing-list">
                    ${this.briefings.map(
                      (b) => html`
                        <li
                          class=${
                            this.selectedBriefing?.id === b.id ? "active" : ""
                          }
                          @click=${() => this.selectBriefing(b.id)}
                        >
                          <div>#${b.id} 交班简报</div>
                          <div class="meta">${this.fmtTime(b.created_at)}</div>
                          <div class="meta">生成人：${b.created_by}</div>
                          <div class="counts">
                            <span>待处理 ${b.pending_count}</span>
                            <span>合格 ${b.ok_count}</span>
                            <span>超差 ${b.over_count}</span>
                          </div>
                        </li>
                      `
                    )}
                  </ul>
                `}
          </div>
          <div>
            <h2 style="margin-top:0;font-size:1rem;">正文预览</h2>
            ${
              this.selectedBriefing
                ? html`
                    <p class="meta muted" style="margin:0 0 0.25rem;font-size:0.8rem;">
                      #${this.selectedBriefing.id} ·
                      ${this.fmtTime(this.selectedBriefing.created_at)} ·
                      ${this.selectedBriefing.created_by} 生成，内容已冻结
                    </p>
                    <pre class="briefing-body">${
                      this.selectedBriefing.body
                    }</pre>
                  `
                : html`<p class="muted">点击左侧历史条目查看冻结正文。</p>`
            }
          </div>
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
