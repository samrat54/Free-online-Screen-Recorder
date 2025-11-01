
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const startBtn = document.getElementById('startBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const recordingTypeSelector = document.getElementById('recordingTypeSelector');
    const startRecordingBtn = document.getElementById('startRecordingBtn');
    const micSelect = document.getElementById('micSelect');
    const systemAudioCheckbox = document.getElementById('systemAudioCheckbox');
    const previewVideo = document.getElementById('previewVideo');
    const recordingsList = document.getElementById('recordingsList');
    const pauseResumeBtn = document.getElementById('pauseResumeBtn');
    const stopRecordingBtn = document.getElementById('stopRecordingBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const newRecordingBtn = document.getElementById('newRecordingBtn');

    // --- App State ---
    let mediaRecorder;
    let stream;
    let recordedChunks = [];
    let recordings = [];
    let timerInterval;
    let secondsElapsed = 0;

    // --- 1. Initialization ---
    function init() {
        setupEventListeners();
        loadRecordings();
        populateMicList();
        loadSettings();
        updateUIMode('idle');
    }

    // --- 2. Event Listeners ---
    function setupEventListeners() {
        startBtn.addEventListener('click', openSettingsModal);
        closeModalBtn.addEventListener('click', closeSettingsModal);
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) closeSettingsModal();
        });
        recordingTypeSelector.addEventListener('click', selectRecordingType);
        startRecordingBtn.addEventListener('click', startRecording);
        pauseResumeBtn.addEventListener('click', togglePauseResume);
        stopRecordingBtn.addEventListener('click', stopRecording);
        recordingsList.addEventListener('click', handleListClick);
        newRecordingBtn.addEventListener('click', resetToIdle);

        const advancedOptionsToggle = document.getElementById('advancedOptionsToggle');
        const advancedOptionsContent = document.getElementById('advancedOptionsContent');
        const advancedOptionsArrow = document.getElementById('advancedOptionsArrow');
        const formatSelect = document.getElementById('formatSelect');
        const qualitySelect = document.getElementById('qualitySelect');

        if (advancedOptionsToggle) {
            advancedOptionsToggle.addEventListener('click', () => {
                const isVisible = advancedOptionsContent.style.display === 'block';
                advancedOptionsContent.style.display = isVisible ? 'none' : 'block';
                if (advancedOptionsArrow) {
                    advancedOptionsArrow.innerHTML = isVisible ? '&#9662;' : '&#9652;';
                }
            });
        }

        if (formatSelect) formatSelect.addEventListener('change', saveSettings);
        if (qualitySelect) qualitySelect.addEventListener('change', saveSettings);
    }

    // --- 3. UI & Modal Logic ---
    function updateUIMode(mode) {
        document.body.dataset.mode = mode;
    }

    function openSettingsModal() {
        settingsModal.classList.add('show');
    }

    function closeSettingsModal() {
        settingsModal.classList.remove('show');
    }

    function selectRecordingType(e) {
        const selectedOption = e.target.closest('.recording-type-option');
        if (!selectedOption) return;

        // Update selection visual
        recordingTypeSelector.querySelectorAll('.recording-type-option').forEach(opt => opt.classList.remove('selected'));
        selectedOption.classList.add('selected');

        // Show/hide system audio option
        const type = selectedOption.dataset.type;
        document.getElementById('systemAudioSetting').style.display = (type === 'screen' || type === 'both') ? 'block' : 'none';
    }

    async function populateMicList() {
        try {
            // Get permission and a temporary stream to enumerate devices.
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices = devices.filter(device => device.kind === 'audioinput');

            micSelect.innerHTML = '<option value="none">No Microphone</option>'; // Fallback

            let defaultDeviceFound = false;
            audioDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Microphone ${micSelect.length}`;

                // The 'default' device is the system default.
                if (device.deviceId === 'default') {
                    option.selected = true;
                    defaultDeviceFound = true;
                }
                micSelect.appendChild(option);
            });

            // If no 'default' device ID, select the first available microphone as a fallback.
            if (!defaultDeviceFound && audioDevices.length > 0) {
                micSelect.value = audioDevices[0].deviceId;
            }

            // Stop the temporary stream tracks.
            tempStream.getTracks().forEach(track => track.stop());

        } catch (err) {
            console.warn('Could not get microphone permissions. Microphone selection will be disabled.');
            // Optionally disable the microphone selection UI
            micSelect.disabled = true;
            micSelect.innerHTML = '<option value="none">Mic permission denied</option>';
        }
    }

    function resetToIdle() {
        previewVideo.srcObject = null;
        previewVideo.src = '';
        previewVideo.controls = false;
        previewVideo.muted = true;
        downloadBtn.onclick = null; // Clear the download handler
        updateUIMode('idle');
    }

    function saveSettings() {
        const settings = {
            format: document.getElementById('formatSelect').value,
            quality: document.getElementById('qualitySelect').value,
        };
        localStorage.setItem('recorderSettings', JSON.stringify(settings));
    }

    function loadSettings() {
        const settings = JSON.parse(localStorage.getItem('recorderSettings'));
        if (settings) {
            if(document.getElementById('formatSelect')) {
                document.getElementById('formatSelect').value = settings.format;
            }
            if(document.getElementById('qualitySelect')) {
                document.getElementById('qualitySelect').value = settings.quality;
            }
        }
    }

    // --- 4. Recording Logic ---
    async function startRecording() {
        closeSettingsModal();
        updateUIMode('recording');
        recordedChunks = [];

        secondsElapsed = 0;
        document.getElementById('timer').textContent = '00:00';

        try {
            const streamParts = await getMediaStreams();
            if (!streamParts) {
                updateUIMode('idle');
                return;
            }
            stream = streamParts;

            previewVideo.srcObject = stream;
            previewVideo.play();

            mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
            mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
            mediaRecorder.onstop = handleStop;
            mediaRecorder.onpause = () => { 
                stopTimer(); 
                updateUIMode('paused'); 
                pauseResumeBtn.dataset.status = 'paused';
            };
            mediaRecorder.onresume = () => { 
                startTimer(); 
                updateUIMode('recording'); 
                pauseResumeBtn.dataset.status = 'recording';
            };

            mediaRecorder.start();
            startTimer();
        } catch (err) {
            console.error('Error starting recording:', err);
            updateUIMode('idle');
        }
    }

    async function getMediaStreams() {
        const selectedOption = recordingTypeSelector.querySelector('.selected');
        const recordType = selectedOption ? selectedOption.dataset.type : 'screen';
        const wantsMic = micSelect.value !== 'none';
        const wantsSystemAudio = systemAudioCheckbox.checked && (recordType === 'screen' || recordType === 'both');
        const videoTracks = [];
        const audioTracks = [];

        try {
            if (recordType === 'screen' || recordType === 'both') {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: wantsSystemAudio });
                videoTracks.push(...screenStream.getVideoTracks());
                if (wantsSystemAudio) audioTracks.push(...screenStream.getAudioTracks());
                screenStream.getVideoTracks()[0].addEventListener('ended', stopRecording);
            }
            if (recordType === 'camera' || recordType === 'both') {
                const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
                videoTracks.push(...camStream.getVideoTracks());
            }
            if (wantsMic) {
                const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: micSelect.value } } });
                audioTracks.push(...micStream.getAudioTracks());
            }
            if (videoTracks.length === 0) return null;
            return new MediaStream([...videoTracks, ...audioTracks]);
        } catch (err) {
            alert(`Permission Error: ${err.message}`);
            return null;
        }
    }

    function togglePauseResume() {
        if (!mediaRecorder) return;
        if (mediaRecorder.state === 'recording') mediaRecorder.pause();
        else if (mediaRecorder.state === 'paused') mediaRecorder.resume();
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    }

    function handleStop() {
        stopTimer();
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        recordedChunks = [];
        const url = URL.createObjectURL(blob);
        const id = Date.now().toString();
        const newRecording = { id, name: `recording-${id}.webm`, date: new Date().toLocaleString(), url, blob };
        recordings.unshift(newRecording);

        previewVideo.srcObject = null;
        previewVideo.src = url;
        previewVideo.controls = true;
        downloadBtn.onclick = () => downloadRecording(id);
        
        updateUIMode('finished');
        saveAndRenderRecordings();
    }

    // --- 5. Timer & List Logic (remains the same as previous correct version) ---
    function startTimer() { /* ... */ }
    function stopTimer() { /* ... */ }
    function saveAndRenderRecordings() { /* ... */ }
    function loadRecordings() { /* ... */ }
    function renderRecordingsList() { /* ... */ }
    function handleListClick(e) { /* ... */ }
    function playRecording(id) { /* ... */ }
    function downloadRecording(id) { /* ... */ }
    function deleteRecording(id) { /* ... */ }

    // Re-adding the full implementation for timer and list functions
    function startTimer() {
        stopTimer();
        timerInterval = setInterval(() => {
            secondsElapsed++;
            const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
            const secs = (secondsElapsed % 60).toString().padStart(2, '0');
            document.getElementById('timer').textContent = `${mins}:${secs}`;
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
    }

    function saveAndRenderRecordings() {
        const metadata = recordings.map(({ id, name, date }) => ({ id, name, date }));
        localStorage.setItem('screenRecordings', JSON.stringify(metadata));
        renderRecordingsList();
    }

    function loadRecordings() {
        const metadata = JSON.parse(localStorage.getItem('screenRecordings')) || [];
        const sessionIds = new Set(recordings.map(r => r.id));
        const loaded = metadata.filter(m => !sessionIds.has(m.id)).map(m => ({ ...m, url: null, blob: null }));
        recordings.push(...loaded);
        renderRecordingsList();
    }

    function renderRecordingsList() {
        recordingsList.innerHTML = recordings.length ? '' : '<li>No recordings yet.</li>';
        recordings.forEach(rec => {
            const li = document.createElement('li');
            li.className = 'recording-item';
            const isPlayable = !!rec.url;
            li.innerHTML = `
                <div class="recording-info"><span>${rec.name}</span><small>${rec.date}</small></div>
                <div class="recording-actions">
                    <button class="play-btn" data-id="${rec.id}" ${!isPlayable ? 'disabled' : ''}>Play</button>
                    <button class="download-btn" data-id="${rec.id}" ${!isPlayable ? 'disabled' : ''}>Download</button>
                    <button class="delete-btn" data-id="${rec.id}">Delete</button>
                </div>
            `;
            recordingsList.appendChild(li);
        });
    }

    function handleListClick(e) {
        const id = e.target.dataset.id;
        if (!id) return;
        if (e.target.classList.contains('play-btn')) playRecording(id);
        if (e.target.classList.contains('download-btn')) downloadRecording(id);
        if (e.target.classList.contains('delete-btn')) deleteRecording(id);
    }

    function playRecording(id) {
        const rec = recordings.find(r => r.id === id);
        if (rec && rec.url) {
            previewVideo.srcObject = null;
            previewVideo.src = rec.url;
            previewVideo.controls = true;
            previewVideo.play();
        }
    }

    function downloadRecording(id) {
        const rec = recordings.find(r => r.id === id);
        if (rec && rec.url) {
            const a = document.createElement('a');
            a.href = rec.url;
            a.download = rec.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    }

    function deleteRecording(id) {
        const rec = recordings.find(r => r.id === id);
        if (rec && rec.url) URL.revokeObjectURL(rec.url);
        recordings = recordings.filter(r => r.id !== id);
        saveAndRenderRecordings();
    }

    init();
});
