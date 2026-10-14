# talking-face

Paleisti (Git Bash, projekto šaknyje; pirmą kartą prieš tai `npm install`):


```bash
npm start
```

```bash
npm start & sleep 2 && npm run show
```

Atidaryk `http://localhost:3000/` – visi puslapiai (2D, 3D, GLB, VRM) antd tabuose.

Išjungti (atlaisvinti 3000 portą):

```bash
taskkill //F //PID $(netstat -ano | awk '/:3000 .*LISTENING/ {print $5; exit}')
```

Daugiau informacijos: `AGENTS.md` (techninės pastabos) ir `HANDOFF.md`.
