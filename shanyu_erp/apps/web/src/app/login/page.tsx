import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-brand-panel" aria-label="山屿品牌介绍">
        <div className="brand-mark brand-mark-large">山屿</div>
        <p className="brand-en">SHANYU DESIGN</p>
        <div className="brand-divider" />
        <h1>让每一份设计，都有清晰的价值。</h1>
        <p>项目、报价与审批，在一个可靠的工作空间中持续沉淀。</p>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <p className="eyebrow">SHANYU ERP</p>
          <h2>欢迎回来</h2>
          <p className="muted-copy">使用公司账号进入工作台</p>
          <LoginForm />
          <div className="demo-account-note">
            本地演示账号：owner / alex / mori
          </div>
        </div>
        <p className="login-footer">山屿设计 · 内部业务系统</p>
      </section>
    </main>
  );
}
