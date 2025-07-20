const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// Configura o caminho do executável ffmpeg
const ffmpegPath = path.join(__dirname, 'ffmpeg', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');
ffmpeg.setFfmpegPath(ffmpegPath);

// Pasta de origem dos vídeos curtos
const INPUT_DIR = path.join(__dirname, 'input');
// Pasta de saída do vídeo final
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'shorts-compilado.mp4');

// Garante que a pasta de saída existe
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
}

// Busca todos os arquivos de vídeo na pasta de entrada
const videos = fs.readdirSync(INPUT_DIR)
    .filter(file => file.endsWith('.mp4'))
    .map(file => path.join(INPUT_DIR, file));

if (videos.length === 0) {
    console.error('Nenhum vídeo encontrado na pasta input.');
    process.exit(1);
}

// Função para obter faixas de áudio da pasta tracks
function getAudioTracks() {
    const tracksDir = path.join(__dirname, 'tracks');
    if (!fs.existsSync(tracksDir)) return [];
    return fs.readdirSync(tracksDir)
        .filter(file => file.endsWith('.mp3') || file.endsWith('.wav'))
        .map(file => path.join(tracksDir, file));
}

// Função para redimensionar, cortar vídeo e substituir áudio
function ajustarResolucoesEVoz(videos, tempDir, tracks) {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    const promises = videos.map((video, idx) => {
        return new Promise((resolve, reject) => {
            const output = path.join(tempDir, `video_${idx}.mp4`);
            // Seleciona uma faixa aleatória
            const audioTrack = tracks[Math.floor(Math.random() * tracks.length)];
            ffmpeg(video)
                .videoCodec('libx264')
                .noAudio()
                .outputOptions([
                    '-preset', 'fast',
                    '-crf', '23',
                    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
                ])
                .on('end', () => {
                    // Adiciona a faixa de áudio ao vídeo
                    ffmpeg()
                        .input(output)
                        .input(audioTrack)
                        .outputOptions([
                            '-c:v', 'copy',
                            '-c:a', 'aac',
                            '-shortest'
                        ])
                        .on('end', () => resolve(output))
                        .on('error', reject)
                        .save(output + '_final.mp4');
                })
                .on('error', reject)
                .save(output);
        });
    });
    // Retorna os arquivos finais
    return Promise.all(promises).then(arr => arr.map(f => f + '_final.mp4'));
}

// Função para obter duração de um vídeo
function getVideoDuration(file) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(file, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration || 0);
        });
    });
}

// Função para dividir vídeos em grupos de ~1 minuto
async function agruparVideosPorDuracao(videos, alvoSegundos = 65) {
    const grupos = [];
    let grupoAtual = [];
    let duracaoAtual = 0;
    for (const video of videos) {
        const duracao = await getVideoDuration(video);
        if (duracaoAtual + duracao > alvoSegundos && grupoAtual.length > 0) {
            grupos.push(grupoAtual);
            grupoAtual = [];
            duracaoAtual = 0;
        }
        grupoAtual.push(video);
        duracaoAtual += duracao;
    }
    if (grupoAtual.length > 0) grupos.push(grupoAtual);
    return grupos;
}

// Função para remover diretório e arquivos recursivamente
function removerDiretorioRecursivo(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                removerDiretorioRecursivo(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(dirPath);
    }
}

// Função para adicionar música ao compilado final
function adicionarMusicaAoCompilado(videoFile, audioTrack, outputFile) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(videoFile)
            .input(audioTrack)
            .outputOptions([
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-shortest'
            ])
            .on('end', () => resolve())
            .on('error', reject)
            .save(outputFile);
    });
}

async function processarGrupos() {
    const grupos = await agruparVideosPorDuracao(videos);
    const tracks = getAudioTracks();
    if (tracks.length === 0) {
        console.error('Nenhuma faixa encontrada na pasta tracks.');
        process.exit(1);
    }
    const tempDirs = [];
    for (let i = 0; i < grupos.length; i++) {
        const grupo = grupos[i];
        const TEMP_DIR = path.join(__dirname, 'temp_' + i);
        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
        tempDirs.push(TEMP_DIR);
        // Remove áudio e redimensiona vídeos
        const ajustados = await Promise.all(grupo.map((video, idx) => {
            return new Promise((resolve, reject) => {
                const output = path.join(TEMP_DIR, `video_${idx}.mp4`);
                ffmpeg(video)
                    .videoCodec('libx264')
                    .noAudio()
                    .outputOptions([
                        '-preset', 'fast',
                        '-crf', '23',
                        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
                    ])
                    .on('end', () => resolve(output))
                    .on('error', reject)
                    .save(output);
            });
        }));
        // Junta os vídeos sem áudio
        const listFile = path.join(OUTPUT_DIR, `videos_${i}.txt`);
        fs.writeFileSync(listFile, ajustados.map(v => `file '${v.replace(/'/g, "'\\''")}'`).join('\n'));
        const tempCompilado = path.join(OUTPUT_DIR, `shorts-compilado-${i + 1}-noaudio.mp4`);
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(listFile)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .outputOptions(['-c', 'copy'])
                .on('end', resolve)
                .on('error', reject)
                .save(tempCompilado);
        });
        // Adiciona música ao compilado final
        const audioTrack = tracks[Math.floor(Math.random() * tracks.length)];
        const outputFile = path.join(OUTPUT_DIR, `shorts-compilado-${i + 1}.mp4`);
        await adicionarMusicaAoCompilado(tempCompilado, audioTrack, outputFile);
        // Limpa arquivos temporários
        ajustados.forEach(f => fs.unlinkSync(f));
        fs.unlinkSync(tempCompilado);
        removerDiretorioRecursivo(TEMP_DIR);
        fs.unlinkSync(listFile);
        console.log(`Compilado ${i + 1} gerado!`);
    }
    // Limpa todas as pastas temp_X restantes
    tempDirs.forEach(dir => {
        if (fs.existsSync(dir)) removerDiretorioRecursivo(dir);
    });
    console.log('Todos os compilados foram gerados!');
}

processarGrupos();
