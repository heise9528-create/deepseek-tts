// ==UserScript==
// @name         DeepSeek 自动朗读
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  DeepSeek Chat 自动朗读AI回复 - 暂停/继续/进度/可拖动/位置记忆 ｜ 兼容 Chrome/Firefox/Safari 现代及主流老旧版本
// @author       蜡笔小新
// @license       MIT
// @match        https://chat.deepseek.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let audioEnabled = true;
    let lastSpokenText = '';
    let lastMessageId = '';
    let unlocked = false;
    let isGenerating = false;
    let debounceTimer = null;
    let isPaused = false;
    let progressText = '';
    let progressTimer = null;

    function debouncedCheck(delay) {
        delay = delay || 400;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            checkForNewResponse();
            debounceTimer = null;
        }, delay);
    }

    function speakText(text, force) {
        if (!force && !audioEnabled) return false;
        if (!unlocked) return false;
        if (!text || text.length < 5) return false;
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        isPaused = false;

        setTimeout(function() {
            var clean = text
                .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
                .replace(/\[\^?\d+\]/g, ' ')
                .replace(/[#*`_~>|\\\/]/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .replace(/\s+/g, ' ')
                .trim();

            var utt = new SpeechSynthesisUtterance(clean);
            utt.rate = 1.05;
            utt.pitch = 1.02;

            var voices = window.speechSynthesis.getVoices();
            var best = null;
            for (var i = 0; i < voices.length; i++) {
                var v = voices[i];
                if (!v.lang.startsWith('zh')) continue;
                if (!best) best = v;
                if (v.name.indexOf('Natural') >= 0 || v.name.indexOf('Xiaoxiao') >= 0 || v.name.indexOf('Huihui') >= 0 || v.name.indexOf('Yunxi') >= 0) {
                    if (v.lang.startsWith('zh')) { best = v; break; }
                }
            }
            if (best) utt.voice = best;

            var total = clean.length;
            utt.onboundary = function(e) {
                if (e.name === 'word' || e.name === 'sentence') {
                    var idx = (typeof e.charIndex === 'number') ? e.charIndex : 0;
                    if (idx === 0 && !e.name) return;
                    var pct = Math.min(Math.round(idx / total * 100), 99);
                    progressText = pct + '%';
                    updateUI();
                }
            };
            utt.onend = function() {
                progressText = '';
                isPaused = false;
                updateUI();
            };
            window.speechSynthesis.speak(utt);
        }, 80);
        return true;
    }

    function togglePause() {
        if (!window.speechSynthesis) return;
        if (window.speechSynthesis.speaking) {
            if (isPaused) { window.speechSynthesis.resume(); isPaused = false; }
            else { window.speechSynthesis.pause(); isPaused = true; }
            updateUI();
        }
    }

    function getLastAssistantText() {
        var contents = document.querySelectorAll('.ds-assistant-message-main-content');
        if (contents.length > 0) {
            var last = contents[contents.length - 1];
            if (!last.querySelector('.ds-loading, [class*="cursor"], .blinking')) {
                var t = (last.innerText || last.textContent || '').trim();
                if (t.length > 0) return t;
            }
        }
        var mds = document.querySelectorAll('.ds-markdown');
        if (mds.length > 0) {
            for (var i = mds.length - 1; i >= 0; i--) {
                if (!mds[i].closest('.ds-think-content')) {
                    var t = (mds[i].innerText || mds[i].textContent || '').trim();
                    if (t.length > 0) return t;
                }
            }
        }
        var roles = document.querySelectorAll('[role="assistant"]');
        if (roles.length > 0) return (roles[roles.length - 1].innerText || '').trim();
        return '';
    }

    function getMessageSignature() {
        var msgs = document.querySelectorAll('.ds-message');
        var count = msgs.length;
        if (count === 0) return '';
        var last = msgs[count - 1];
        var id = last.getAttribute('data-message-id') || last.getAttribute('data-id');
        if (id) return id;
        return count + ':' + (last.innerText || '').trim().length;
    }

    function checkGenerating() {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            var path = btns[i].querySelector('svg path');
            if (path && path.getAttribute('d') && path.getAttribute('d').indexOf('stop') >= 0) return true;
        }
        if (document.querySelector('.ds-message .ds-loading, .ds-message .generating')) return true;
        return false;
    }

    function checkForNewResponse() {
        if (!audioEnabled) return;
        var gen = checkGenerating();
        if (gen) { isGenerating = true; return; }
        var was = isGenerating;
        isGenerating = false;
        var text = getLastAssistantText();
        var sig = getMessageSignature();
        if (!text) return;
        if ((sig !== lastMessageId && sig !== '') || was) {
            if (text !== lastSpokenText) {
                lastSpokenText = text;
                lastMessageId = sig;
                speakText(text, false);
            }
        }
    }

    function setupObserver() {
        var observer = new MutationObserver(function() { debouncedCheck(400); });
        observer.observe(document.querySelector('#root') || document.body, { childList: true, subtree: true, characterData: true });
    }

    // --- 控制面板 ---
    function createPanel() {
        if (document.getElementById('ds-voice-panel')) return;
        if (progressTimer) clearInterval(progressTimer);

        var panel = document.createElement('div');
        panel.id = 'ds-voice-panel';
        panel.style.cssText = 'position:fixed;bottom:25px;right:100px;z-index:999999;' +
            'background:rgba(30,30,40,0.92);border:2px solid #4f8cf7;border-radius:12px;' +
            'padding:8px 14px;box-shadow:0 4px 20px rgba(0,0,0,0.5);' +
            'display:flex;align-items:center;gap:8px;backdrop-filter:blur(6px);' +
            'font-family:system-ui,sans-serif;user-select:none;';

        var dot = document.createElement('span');
        dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#4f8cf7;flex-shrink:0;';
        var label = document.createElement('span');
        label.style.cssText = 'color:white;font-size:13px;font-weight:bold;white-space:nowrap;';
        label.innerText = '朗读';

        var pauseBtn = document.createElement('button');
        pauseBtn.style.cssText = 'background:#8b5cf6;color:white;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;display:none;';
        pauseBtn.innerText = '⏸ 暂停';

        var prog = document.createElement('span');
        prog.style.cssText = 'color:#a1a1aa;font-size:11px;min-width:32px;text-align:right;';

        var toggle = document.createElement('button');
        toggle.style.cssText = 'background:#4f8cf7;color:white;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:bold;';
        toggle.innerText = '关';

        var reread = document.createElement('button');
        reread.style.cssText = 'background:#10b981;color:white;border:none;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;';
        reread.innerText = '🔁';

        pauseBtn.addEventListener('click', function(e) { e.stopPropagation(); togglePause(); });
        reread.addEventListener('click', function(e) {
            e.stopPropagation();
            var t = getLastAssistantText();
            if (t && t.length > 5) { speakText(t, true); lastSpokenText = t; }
        });
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            audioEnabled = !audioEnabled;
            if (!audioEnabled) {
                if (window.speechSynthesis) window.speechSynthesis.cancel();
                isPaused = false; progressText = '';
                pauseBtn.style.display = 'none'; prog.innerText = '';
            } else {
                setTimeout(function() {
                    var t = getLastAssistantText();
                    if (t && t !== lastSpokenText) {
                        lastSpokenText = t;
                        lastMessageId = getMessageSignature();
                        speakText(t, false);
                    }
                }, 200);
            }
            var c = audioEnabled ? '#4f8cf7' : '#ef4444';
            dot.style.background = c; panel.style.borderColor = c;
            toggle.innerText = audioEnabled ? '关' : '开'; toggle.style.background = c;
            label.innerText = audioEnabled ? '朗读' : '已停';
        });

        panel.appendChild(dot);
        panel.appendChild(label);
        panel.appendChild(pauseBtn);
        panel.appendChild(prog);
        panel.appendChild(toggle);
        panel.appendChild(reread);
        document.body.appendChild(panel);

        // --- 面板拖拽 + 位置记忆 ---
        (function(el) {
            var saved = localStorage.getItem('ds_panel_pos');
            if (saved) {
                try {
                    var pos = JSON.parse(saved);
                    el.style.left = pos.x + 'px';
                    el.style.top = pos.y + 'px';
                    el.style.right = 'auto';
                    el.style.bottom = 'auto';
                } catch(e) {}
            }

            var dragging = false, sx, sy, ox, oy;
            el.addEventListener('mousedown', function(e) {
                if (e.target.tagName === 'BUTTON') return;
                dragging = true;
                var r = el.getBoundingClientRect();
                sx = e.clientX; sy = e.clientY;
                ox = r.left; oy = r.top;
                el.style.cursor = 'grabbing';
                el.style.transition = 'none';
            });
            document.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                e.preventDefault();
                el.style.left = (ox + e.clientX - sx) + 'px';
                el.style.top = (oy + e.clientY - sy) + 'px';
                el.style.right = 'auto'; el.style.bottom = 'auto';
            });
            document.addEventListener('mouseup', function() {
                if (!dragging) return;
                dragging = false;
                el.style.cursor = 'grab'; el.style.transition = '';
                if (el.style.left && el.style.left !== 'auto') {
                    localStorage.setItem('ds_panel_pos', JSON.stringify({
                        x: parseInt(el.style.left),
                        y: parseInt(el.style.top)
                    }));
                }
            });
            el.addEventListener('touchstart', function(e) {
                if (e.target.tagName === 'BUTTON') return;
                var t = e.touches[0];
                var r = el.getBoundingClientRect();
                sx = t.clientX; sy = t.clientY;
                ox = r.left; oy = r.top;
                dragging = true;
                el.style.transition = 'none';
            }, { passive: true });
            document.addEventListener('touchmove', function(e) {
                if (!dragging) return;
                var t = e.touches[0];
                el.style.left = (ox + t.clientX - sx) + 'px';
                el.style.top = (oy + t.clientY - sy) + 'px';
                el.style.right = 'auto'; el.style.bottom = 'auto';
            }, { passive: true });
            document.addEventListener('touchend', function() {
                if (!dragging) return;
                dragging = false; el.style.transition = '';
                if (el.style.left && el.style.left !== 'auto') {
                    localStorage.setItem('ds_panel_pos', JSON.stringify({
                        x: parseInt(el.style.left),
                        y: parseInt(el.style.top)
                    }));
                }
            });
            el.style.cursor = 'grab';
        })(panel);

        // --- UI 更新函数 ---
        window.updateUI = function() {
            if (window.speechSynthesis && window.speechSynthesis.speaking) {
                pauseBtn.style.display = '';
                pauseBtn.innerText = isPaused ? '▶ 继续' : '⏸ 暂停';
                pauseBtn.style.background = isPaused ? '#f59e0b' : '#8b5cf6';
                prog.innerText = progressText || '';
            } else {
                pauseBtn.style.display = 'none';
                prog.innerText = '';
            }
        };
        progressTimer = setInterval(window.updateUI, 500);
    }

    function unlockOnFirstClick() {
        if (unlocked) return;
        function handler() {
            if (!unlocked) {
                var d = new SpeechSynthesisUtterance(' '); d.volume = 0;
                window.speechSynthesis.speak(d);
                unlocked = true;
                document.removeEventListener('click', handler);
            }
        }
        document.addEventListener('click', handler);
        document.addEventListener('touchstart', handler, { once: true });
    }

    setInterval(function() { if (window.speechSynthesis) window.speechSynthesis.getVoices(); }, 5000);

    function init() {
        var iv = setInterval(function() {
            if (document.querySelector('.ds-message') || document.querySelector('#root')) {
                clearInterval(iv);
                setTimeout(function() { createPanel(); setupObserver(); }, 1500);
            }
        }, 500);
    }

    unlockOnFirstClick();
    init();
})();

