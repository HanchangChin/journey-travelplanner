# Vercel 部署指南

本指南将帮助你部署 Journey Travel Planner 到 Vercel，并确保 Universal Links 正常工作。

## 部署方式

### 方式一：通过 Git 仓库自动部署（推荐）

如果你的项目已经连接到 Git 仓库（GitHub、GitLab 或 Bitbucket），这是最简单的方式。

#### 步骤：

1. **确保文件已提交到 Git**

   ```bash
   cd "/Users/hans/文件/Hans_App/Journey-TravelPlanner"
   
   # 检查文件状态
   git status
   
   # 添加新文件和修改
   git add public/apple-app-site-association vercel.json
   
   # 提交更改
   git commit -m "Add Universal Links support: apple-app-site-association file"
   
   # 推送到远程仓库
   git push
   ```

2. **Vercel 自动部署**

   - 如果项目已经连接到 Vercel，推送代码后会自动触发部署
   - 在 Vercel Dashboard 中查看部署状态

3. **验证部署**

   部署完成后，访问以下 URL 验证文件是否正确部署：
   ```
   https://journey-travelplanner.vercel.app/apple-app-site-association
   ```
   
   应该能看到 JSON 内容，且 Content-Type 为 `application/json`。

---

### 方式二：通过 Vercel CLI 部署

如果没有使用 Git，可以使用 Vercel CLI 直接部署。

#### 步骤：

1. **安装 Vercel CLI**（如果还没有安装）

   ```bash
   npm install -g vercel
   ```

2. **登录 Vercel**

   ```bash
   vercel login
   ```

3. **部署项目**

   ```bash
   cd "/Users/hans/文件/Hans_App/Journey-TravelPlanner"
   vercel
   ```

   如果是第一次部署，CLI 会询问一些问题：
   - 是否要链接到现有项目？选择 `Y` 并输入项目名称
   - 或者创建新项目

4. **生产环境部署**

   ```bash
   vercel --prod
   ```

---

### 方式三：通过 Vercel 网页界面部署

1. **访问 Vercel Dashboard**

   打开 https://vercel.com/dashboard

2. **选择项目**

   点击你的 `journey-travelplanner` 项目

3. **手动部署**

   - 点击 **Deployments** 标签页
   - 点击 **Redeploy** 按钮（如果有）
   - 或者通过 Git 推送触发新部署

---

## 验证部署

### 1. 验证 apple-app-site-association 文件

部署完成后，在浏览器中访问：

```
https://journey-travelplanner.vercel.app/apple-app-site-association
```

**应该看到：**
- JSON 内容正确显示
- Content-Type 为 `application/json`（在浏览器开发者工具的 Network 标签中查看）

**如果看到 404 错误：**
- 检查文件是否在 `public/` 目录下
- 检查文件名是否正确（**不要**有 `.json` 扩展名）
- 检查 `vercel.json` 配置是否正确

### 2. 验证 .well-known 路径（可选）

某些情况下，文件可能需要放在 `.well-known/` 目录下。如果上面的路径不工作，可以尝试：

```
https://journey-travelplanner.vercel.app/.well-known/apple-app-site-association
```

如果需要，可以在 `public/` 目录下创建 `.well-known/` 文件夹，并将文件复制到那里。

### 3. 使用 Apple 验证工具

访问 Apple 的验证工具测试配置：

```
https://search.developer.apple.com/appsearch-validation-tool/
```

输入你的域名：`journey-travelplanner.vercel.app`

---

## 常见问题

### Q: 文件部署后返回 404

**解决方案：**
1. 确保文件在 `public/` 目录下
2. 确保文件名是 `apple-app-site-association`（**没有扩展名**）
3. 检查 `vercel.json` 中的 headers 配置
4. 尝试重新部署

### Q: Content-Type 不正确

**解决方案：**
- 检查 `vercel.json` 中的 headers 配置是否正确
- 确保 `vercel.json` 已正确部署

### Q: 如何强制重新部署？

**解决方案：**
```bash
# 通过 CLI
vercel --prod --force

# 或通过 Git
git commit --allow-empty -m "Trigger redeploy"
git push
```

---

## 部署后的下一步

部署成功后：

1. **在 Xcode 中配置 Associated Domains**
   - 参考 `UNIVERSAL_LINKS_SETUP.md`

2. **测试 Universal Links**
   - 在 iPhone 上安装 app
   - 在 Safari 中访问分享链接
   - 应该自动在 app 中打开

---

## 快速检查清单

- [ ] `public/apple-app-site-association` 文件已创建
- [ ] `vercel.json` 已更新（包含 headers 配置）
- [ ] 文件已提交到 Git（如果使用 Git 部署）
- [ ] 已部署到 Vercel
- [ ] 文件可以通过 HTTPS 访问
- [ ] Content-Type 为 `application/json`
- [ ] 在 Xcode 中配置了 Associated Domains

完成以上步骤后，Universal Links 应该可以正常工作了！
