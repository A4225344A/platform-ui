# 2026-09-08 Incident 建議處理指令手把手執行文件

## 文件目的

這份文件說明如何把 EngOps UI 的 Incident 詳情頁，從「只顯示 AI 判斷結果」調整為「顯示建議處理方式，並附上可執行的診斷指令」。

這次修正的目標不是讓畫面變好看，而是解決使用者看到 `notify_only` 或 404 證據時，不知道下一步該怎麼處理的問題。

## 適用情境

當 Incident 詳情頁已有後端資料，例如：

```text
timeline.step = judged
detail.action = notify_only
detail.reason = Deployment not found in cluster (404 errors on both events and logs)
```

但 UI 只顯示 AI Assessment，沒有明確列出人工處置步驟與指令時，使用本文件。

## 1. 確認問題

先確認 CloudFront 上的 incident API 是否已經有 AI 判斷資料。

```bash
curl -fsS "https://dnj13mf2no780.cloudfront.net/api/v1/incidents/844"
```

應確認 payload 內有類似內容：

```json
{
  "step": "judged",
  "detail": {
    "action": "notify_only",
    "reason": "Deployment not found in cluster (404 errors on both events and logs)."
  }
}
```

如果 API 沒有 `judged` step，UI 無法自行產生 AI 建議，只能顯示等待判讀。

## 2. 修改 UI 結構

主要修改檔案：

```text
src/App.tsx
src/App.css
src/i18n.ts
```

在 `IncidentPage` 內，從 timeline 取出 AI 判斷與 guard 判斷：

```tsx
const judgedDetail = judgedDetailFromTimeline(data.timeline)
const guardDetail = guardDetailFromTimeline(data.timeline)
const recommendationSteps = incidentRecommendationSteps(labels, data.service, judgedDetail, guardDetail)
```

接著在 Incident summary 下方、Timeline 上方加入建議卡：

```tsx
<RecommendationPanel
  labels={labels}
  judged={judgedDetail}
  steps={recommendationSteps}
/>
```

這樣使用者一進 Incident 頁，就會先看到：

```text
建議處理方式
AI 建議動作
判斷理由
下一步
可複製指令
```

## 3. 產生建議步驟與指令

新增 `RecommendationStep` 型別：

```tsx
type RecommendationStep = {
  text: string
  commands: string[]
}
```

新增 `incidentRecommendationSteps()`，依據 `judged.reason`、`judged.action`、`guarded.detail` 產生不同步驟。

### 404 / Deployment not found

當 reason 包含：

```text
404
not found
deployment
```

UI 會顯示目標確認與 RBAC/API 檢查指令：

```bash
kubectl get deployment -A | grep '<service>'
kubectl get pods -A | grep '<service>'
kubectl auth can-i get deployments --all-namespaces
kubectl auth can-i get events --all-namespaces
kubectl get events -A --field-selector involvedObject.name=<service>
```

### tier-0 / human approval

當 guard 顯示 tier-0、human approval 或 policy downgrade 時，UI 會提示轉交 owner，並提供 read-only 確認指令：

```bash
kubectl get deployment <deployment> -n <namespace> -o wide
kubectl describe deployment <deployment> -n <namespace>
```

### restart / rollback

若 AI 建議動作是 `restart` 或 `rollback`，UI 會顯示需要人工核准後才可執行的指令：

```bash
kubectl rollout restart deployment/<deployment> -n <namespace>
kubectl rollout undo deployment/<deployment> -n <namespace>
kubectl rollout status deployment/<deployment> -n <namespace>
```

注意：這些指令只顯示在 UI，不會由瀏覽器自動執行。

## 4. 加入複製按鈕

每一條 command row 使用 `<code>` 顯示指令，並提供複製按鈕：

```tsx
<button
  className="icon-button mini"
  type="button"
  aria-label={labels.text('incident.copyCommand')}
  title={labels.text('incident.copyCommand')}
  onClick={() => void navigator.clipboard?.writeText(command)}
>
  <Clipboard size={14} />
</button>
```

這樣使用者可以直接複製指令到 CloudShell 或自己的 kubectl 環境。

## 5. 補 i18n 文案

在 `src/i18n.ts` 的 `incident` 區塊加入中英文文案：

```text
recommendedHandling
recommendedReason
nextSteps
recommendationCheckTarget
recommendationCheckAccess
recommendationEscalateOwner
recommendationPrepareApproval
recommendationVerifyAfterAction
recommendationManualReview
copyCommand
```

中文畫面會顯示：

```text
建議處理方式
判斷理由
下一步
複製指令
```

## 6. 補 CSS 樣式

新增樣式區塊：

```text
.recommendation-panel
.recommendation-heading
.recommendation-body
.recommendation-commands
.command-row
.icon-button.mini
```

重點是 command row 要限制在自己的容器內：

```css
.command-row {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 30px;
}

.command-row code {
  overflow-x: auto;
  white-space: pre;
}
```

手機版要避免長 service name 或長指令把整頁撐寬：

```css
@media (max-width: 820px) {
  .incident-layout > *,
  .recommendation-panel,
  .timeline-panel,
  .detail-panel {
    min-width: 0;
    max-width: 100%;
  }
}
```

## 7. 本機驗證

先跑靜態檢查與 build：

```bash
cd ~/platform-ui
npm run lint
npm run build
```

預期結果：

```text
oxlint: PASS
tsc -b: PASS
vite build: PASS
```

再啟動 UI：

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

如果本機沒有後端，可用 mock API 驗證 `incidents/844`：

```bash
node -e "const http=require('http');const json=(res,obj)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(obj));};const incident={id:844,service:'scorecard-eval-29813587-ppc89',started_at:'2026-09-07T21:12:33.084000Z',timeline:[{at:'2026-09-07T21:13:08.597270Z',step:'judged',detail:{action:'notify_only',reason:'Deployment not found in cluster (404 errors on both events and logs). Cannot verify current state or resource availability.'}},{at:'2026-09-07T21:13:08.804545Z',step:'guarded',detail:{tier_policy:'tier-0, policy does not allow auto-remediation',downgraded_by:'tier_policy',human_approval_required:true}}],timeline_stale:false,agent_log_url:null,owner_team:null,owner_email:null,escalation_email:null};http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/readyz'||u==='/healthz'){res.writeHead(200);return res.end('ok')}if(u==='/api/v1/incidents/844')return json(res,incident);if(u==='/api/v1/accuracy')return json(res,{service:incident.service,verified:0,failed:0,notify_only:1,remediation_rate:null});res.writeHead(404);res.end('not found')}).listen(8000,'127.0.0.1',()=>console.log('mock incident api on 8000'))"
```

開啟：

```text
http://127.0.0.1:5173/incidents/844
```

畫面應看到：

```text
建議處理方式
只通知
判斷理由
下一步
kubectl get deployment -A | grep 'scorecard-eval-29813587-ppc89'
kubectl get pods -A | grep 'scorecard-eval-29813587-ppc89'
kubectl auth can-i get deployments --all-namespaces
kubectl auth can-i get events --all-namespaces
```

## 8. 視覺檢查

桌面版重點：

```text
建議處理方式出現在 Timeline 上方
右側仍保留 AI Assessment / Safety checks / Track Record
每條指令有 code box 和 copy button
```

手機版重點：

```text
長 service name 可換行
長指令只在 code box 內橫向捲動
整頁不應被 command 撐出水平捲軸
```

可用 headless Chrome 截圖：

```bash
chrome --headless --disable-gpu --screenshot=incident-844.png --window-size=390,1600 http://127.0.0.1:5173/incidents/844
```

Windows CloudShell 若遇到 GPU 問題，可加：

```bash
--disable-gpu-compositing --disable-features=UseSkiaRenderer --use-gl=swiftshader --no-sandbox
```

## 9. Commit / Push

確認工作樹：

```bash
git status --short
```

提交：

```bash
git add src/App.tsx src/App.css src/i18n.ts
git commit -m "feat: add incident recommendation commands"
git push origin main
```

本次實際 commit：

```text
6ac8c88 feat: add incident recommendation commands
```

## 10. CloudFront 部署確認

推送後，GitHub Actions 會執行 UI deploy workflow，將 `dist/` 上傳到 S3 並建立 CloudFront invalidation。

確認線上版本：

```bash
curl -fsS "https://dnj13mf2no780.cloudfront.net/version.json"
```

預期 `short_commit` 開頭為：

```text
6ac8c88
```

確認頁面：

```text
https://dnj13mf2no780.cloudfront.net/incidents/844
```

如果 `version.json` 已更新但瀏覽器仍是舊畫面，使用無痕視窗或 hard refresh。

## 11. 回復方式

若部署後要回復，可 revert UI commit：

```bash
git revert 6ac8c88
git push origin main
```

推送後同樣等待 GitHub Actions 部署與 CloudFront invalidation 完成。

## 驗證結果

```text
npm run lint: PASS
npm run build: PASS
本機 incident 844 mock data: PASS
CloudFront version.json: 6ac8c8841ddf
正式頁面: https://dnj13mf2no780.cloudfront.net/incidents/844
```
