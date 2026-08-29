import Image from "next/image";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-brand-panel" aria-label="山屿品牌介绍">
        <div className="login-brand">
          <Image
            alt="山屿"
            className="brand-logo"
            height={38}
            priority
            src="/images/shanyu-logo.png"
            width={38}
          />
          <span className="brand-name">山屿 ERP</span>
        </div>
        <div className="login-value">
          <h1>从报价开始，<br />把每个项目管清楚。</h1>
          <p>统一材料价格、空间工程量、主材选型与成本毛利，形成可追溯的项目基准。</p>
        </div>
        <p className="login-copyright">山屿装饰设计有限公司 · 内部业务系统</p>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <h2>欢迎进入山屿 ERP</h2>
          <p className="muted-copy">使用公司分配的账号登录山屿 ERP</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
