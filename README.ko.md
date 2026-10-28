# Vibe Patch

**원하는 기능을 설명하고 → Claude·OpenAI·Gemini 중 선택하고 → 변경 내용을 확인한 뒤 적용하세요.**

세 서비스의 API를 연결해 자연어로 코드를 생성·수정하는 오픈소스 CLI입니다. MIT 라이선스이며, 내 컴퓨터에서 실행합니다. 외부 AI SDK 대신 Node.js 기본 `fetch` 기능과 자체 제작한 작은 HTTP 어댑터를 사용하므로 실행용 npm 라이브러리 설치가 필요하지 않습니다.

## 설치

Node.js 22 이상이 필요합니다. 압축을 풀고 프로젝트 폴더에서 실행하세요.

```sh
npm ci
npm link
vibe-patch --help
```

아직 npm에 배포된 패키지가 아닙니다. 위 명령은 받은 소스로 설치합니다.

## API 없이 먼저 체험

```sh
mkdir my-demo
cd my-demo
vibe-patch demo
vibe-patch apply
```

`APPLY`를 입력하면 고정된 데모 파일 `vibe-demo.html`이 만들어집니다. 브라우저로 열어보세요. 이 데모는 AI 호출을 하지 않습니다.

## AI 연결

`.env.example`을 별도의 비공개 `.env` 파일로 복사하고 사용할 서비스의 API 키를 넣으세요.

| 서비스 | 선택 옵션 | 필요한 환경 변수 |
| --- | --- | --- |
| Claude | `--provider claude` | `ANTHROPIC_API_KEY` |
| ChatGPT 계열 OpenAI 모델 | `--provider openai` | `OPENAI_API_KEY` |
| Gemini | `--provider gemini` | `GOOGLE_GENERATIVE_AI_API_KEY` |

키는 채팅이나 GitHub에 올리지 마세요. 이 도구는 각 서비스의 웹사이트 로그인이나 구독을 연결하지 않고 API를 호출합니다. API 사용량에 따른 비용이 발생할 수 있습니다.

환경 변수가 설정되어 있다면:

```sh
vibe-patch chat --provider claude --model YOUR_CLAUDE_MODEL_ID
vibe-patch chat --provider openai --model YOUR_OPENAI_MODEL_ID
vibe-patch chat --provider gemini --model YOUR_GEMINI_MODEL_ID
```

`YOUR_*_MODEL_ID`는 실제 모델명이 아닙니다. 본인 API 계정에서 사용 가능한 정확한 텍스트 생성 모델 ID로 바꿔야 합니다. 모델 목록 링크는 [영문 문서](README.md)에 있습니다.

비공개 `.env` 파일을 직접 읽어 실행할 수도 있습니다:

```sh
node --env-file=C:/private/.env C:/path/to/vibe-patch/src/cli.js chat --provider claude --model YOUR_CLAUDE_MODEL_ID
```

## 바이브코딩 예시

새 프로젝트 디렉터리에서:

```sh
vibe-patch propose "반응형 할 일 앱을 index.html로 만들어줘. localStorage에 저장해줘" --provider gemini --model YOUR_GEMINI_MODEL_ID
vibe-patch apply
```

기존 파일을 수정하려면 `--file`로 지정하세요.

```sh
vibe-patch chat --provider claude --model YOUR_CLAUDE_MODEL_ID --file index.html
```

이후 `다크 모드 버튼을 추가해줘`처럼 요청합니다. 변경 전후를 확인하고 `APPLY`로 적용하거나 Enter로 건너뜁니다. 적용된 파일은 다음 요청의 문맥에 포함됩니다.

대화 중 모델을 바꾸려면:

```text
/model openai YOUR_OPENAI_MODEL_ID
/model gemini YOUR_GEMINI_MODEL_ID
/model claude YOUR_CLAUDE_MODEL_ID
/files index.html styles.css
/exit
```

선택한 파일 내용과 현재 요청이 AI 서비스로 전달됩니다. 모델을 바꾸면 다음 요청부터 새 서비스로 전달됩니다. 파일명 제한은 비밀값을 탐지하는 기능이 아니므로 소스에 키가 없는지 직접 확인하세요. 이전 대화 문장 자체는 보관하지 않습니다.

## 되돌리기와 제한

- 적용 후 출력된 ID로 `vibe-patch undo BACKUP_ID`를 실행하면 원본으로 복원합니다.
- 제안 또는 적용 이후 파일이 바뀌면 덮어쓰기를 거부합니다.
- 제안·백업은 `.vibepatch/`에 저장됩니다. 소스 사본이 있으므로 Git에 올리지 마세요.
- 최대 20개 파일, 출력 및 선택한 문맥 각각 200 KB입니다.
- 파일 삭제, 명령 실행, 자동 테스트 실행은 지원하지 않습니다.
- Git 체크포인트를 만든 후 사용하세요. 여러 파일 쓰기는 운영체제 장애에 대해 원자적이지 않습니다.
- 여러 프로세스가 같은 디렉터리를 동시에 변경하지 않도록 하세요.

## 검증

```sh
npm run check
npm test
```

테스트는 모의 응답과 가짜 API 키로 진행됩니다. 실제 세 서비스의 호출은 본인의 API 키와 모델 ID를 설정한 뒤 확인해야 합니다. 제공자 API 형식은 바뀔 수 있으므로 실제 서비스 출시 전 별도 연동 검증이 필요합니다.
