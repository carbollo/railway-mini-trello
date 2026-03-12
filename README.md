# Mini Trello – Gestor de proyectos para Railway

Aplicación sencilla tipo **Trello**: permite crear **tableros**, **listas** dentro de cada tablero y **tarjetas** dentro de cada lista, con una interfaz Kanban minimalista y drag & drop básico entre listas.

Stack:

- **Node.js + Express**
- **PostgreSQL** (ideal para Railway)
- Vistas **EJS** + CSS propio

## 1. Ejecutar en local

### Requisitos

- Node.js 18+  
- PostgreSQL accesible (local o remoto)

### Pasos

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Copia el archivo de entorno:

   ```bash
   cp .env.example .env
   ```

3. Edita `.env` y pon tu cadena de conexión:

   ```env
   DATABASE_URL=postgres://usuario:password@localhost:5432/kanban
   DATABASE_SSL=false
   ```

4. Lanza el servidor en modo desarrollo:

   ```bash
   npm run dev
   ```

5. Abre en el navegador:

   - `http://localhost:3000`

La primera vez que arranca, la app crea automáticamente las tablas `boards`, `lists` y `cards` si no existen.

## 2. Despliegue en Railway

1. Sube este proyecto a un repo (GitHub, GitLab, etc.).
2. En Railway, crea un nuevo proyecto y elige **Deploy from GitHub repo** apuntando a este repo.
3. Railway detectará Node.js y usará el script:

   ```json
   "start": "node server.js"
   ```

4. En el mismo proyecto de Railway, añade un recurso **PostgreSQL**.
5. Copia la variable de entorno `DATABASE_URL` que genera Railway y añádela al servicio Node:

   - Ve a **Variables** del servicio Node.
   - Crea una variable `DATABASE_URL` con el valor proporcionado por PostgreSQL.
   - Opcional: añade `DATABASE_SSL=true` (Railway usa SSL por defecto).

6. Vuelve a desplegar (Redeploy). Railway arrancará la app, creará el esquema y expondrá una URL pública.

## 3. Estructura principal

- `server.js`: servidor Express, conexión a PostgreSQL y rutas.
- `views/boards.ejs`: listado de tableros y formulario para crear nuevos.
- `views/board.ejs`: vista de un tablero con sus listas y tarjetas, y drag & drop entre listas.
- `public/css/styles.css`: estilos de la interfaz tipo Trello.
- `.env.example`: plantilla de variables de entorno.

## 4. Limitaciones y posibles mejoras

- No hay autenticación de usuarios (todos comparten los mismos tableros).
- No hay gestión fina del orden de tarjetas (solo se las coloca al final de la lista).
- No hay archivado/eliminación de tarjetas ni listas.

Sugerencias de mejora:

- Añadir login/registro y asociar tableros a usuarios.
- Mejorar drag & drop para reordenar tarjetas dentro de la misma lista.
- Añadir edición/eliminación de tableros, listas y tarjetas.

