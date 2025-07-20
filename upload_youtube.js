const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');

const OUTPUT_DIR = path.join(__dirname, 'output');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const PROGRESS_PATH = path.join(__dirname, 'upload_progress.json');

// Horários de agendamento (UTC-3)
const SCHEDULE_HOURS = [11, 18, 21];

function getNextScheduleDate(lastDate, idx) {
    // Agenda para o próximo horário disponível
    let next = new Date(lastDate);
    next.setHours(SCHEDULE_HOURS[idx % SCHEDULE_HOURS.length], 0, 0, 0);
    if (next <= lastDate) next.setDate(next.getDate() + 1);
    return next;
}

function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    if (fs.existsSync(TOKEN_PATH)) {
        oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
        callback(oAuth2Client);
    } else {
        getAccessToken(oAuth2Client, callback);
    }
}

function getAccessToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
            callback(oAuth2Client);
        });
    });
}

function uploadVideo(auth, filePath, title, description, publishAt) {
    const youtube = google.youtube({ version: 'v3', auth });
    return youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
            snippet: {
                title,
                description,
                tags: ['shorts', 'automator'],
                categoryId: '22', // People & Blogs
            },
            status: {
                privacyStatus: 'private',
                publishAt: publishAt.toISOString(),
                selfDeclaredMadeForKids: false,
            },
        },
        media: {
            body: fs.createReadStream(filePath),
        },
    });
}

// Lista de objetos para títulos
const OBJETOS = [
    'bola de futebol', 'livro', 'celular', 'brinquedo', 'lata', 'fruta', 'caneca', 'boneco', 'plástico', 'metal', 'madeira', 'vidro', 'teclado', 'controle', 'fidget spinner', 'action figure', 'garrafa', 'relógio', 'mouse', 'câmera', 'sapato', 'pilha', 'copo', 'carro de brinquedo', 'bola de tênis', 'calculadora', 'brinquedo antigo', 'capacete', 'fita cassete', 'disco', 'bola de borracha', 'livro velho'
];

const TITULO_PADRAO = 'Short Satisfatório: Prensa Hidráulica Amassando Objetos';
const DESCRICAO_PADRAO = 'Veja a prensa hidráulica esmagando diferentes objetos em vídeos curtos e satisfatórios! Inscreva-se para mais shorts de destruição e curiosidades. #prensahidraulica #satisfatorio #shorts #esmagando #curiosidades';

function getLastProgress(videos) {
    if (!fs.existsSync(PROGRESS_PATH)) return { idx: -1, lastDate: null };
    try {
        const data = JSON.parse(fs.readFileSync(PROGRESS_PATH));
        const idx = videos.findIndex(v => v === data.lastUploaded);
        return { idx, lastDate: data.lastDate ? new Date(data.lastDate) : null };
    } catch {
        return { idx: -1, lastDate: null };
    }
}

function saveLastProgress(videoName, lastDate) {
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ lastUploaded: videoName, lastDate: lastDate ? lastDate.toISOString() : null }));
}

function main() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error('credentials.json não encontrado. Baixe do Google Cloud Console.');
        process.exit(1);
    }
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    authorize(credentials, async (auth) => {
        const videos = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.mp4'));
        let { idx: startIdx, lastDate } = getLastProgress(videos);
        startIdx = startIdx + 1;
        if (!lastDate) {
            lastDate = new Date();
            lastDate.setHours(0,0,0,0);
        }
        for (let i = startIdx; i < videos.length; i++) {
            const file = path.join(OUTPUT_DIR, videos[i]);
            const title = TITULO_PADRAO;
            const description = DESCRICAO_PADRAO;
            const publishAt = getNextScheduleDate(lastDate, i);
            lastDate = publishAt;
            console.log(`Enviando ${videos[i]} para ${publishAt.toLocaleString('pt-BR')}`);
            try {
                await uploadVideo(auth, file, title, description, publishAt);
                console.log(`Upload de ${videos[i]} agendado para ${publishAt.toLocaleString('pt-BR')}`);
                saveLastProgress(videos[i], lastDate);
            } catch (err) {
                console.error('Erro ao enviar:', err);
                saveLastProgress(videos[i-1] || null, lastDate);
                break;
            }
        }
    });
}

main();
