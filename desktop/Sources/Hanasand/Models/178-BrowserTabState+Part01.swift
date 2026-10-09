import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

extension BrowserTabState {
    func load(_ rawValue: String) {
        guard let url = normalizedURL(from: rawValue) else {
            statusText = "Enter a valid address"
            return
        }

        address = url.absoluteString
        statusText = "Loading \(url.host ?? url.absoluteString)"
        webView.load(URLRequest(url: url))
    }

    func goBack() {
        if webView.canGoBack {
            webView.goBack()
        }
    }

    func goForward() {
        if webView.canGoForward {
            webView.goForward()
        }
    }

    func reloadOrStop() {
        if webView.isLoading {
            webView.stopLoading()
        } else {
            webView.reload()
        }
    }

    func refreshAgentElements() {
        let script = """
        (() => {
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const cssPath = (el) => {
            if (el.id) return '#' + CSS.escape(el.id);
            const parts = [];
            while (el && el.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
              let part = el.nodeName.toLowerCase();
              if (el.classList.length) part += '.' + [...el.classList].slice(0, 2).map(CSS.escape).join('.');
              const parent = el.parentElement;
              if (parent) {
                const same = [...parent.children].filter(child => child.nodeName === el.nodeName);
                if (same.length > 1) part += `:nth-of-type(${same.indexOf(el) + 1})`;
              }
              parts.unshift(part);
              el = parent;
            }
            return parts.join(' > ');
          };
          const roleFor = (el) => {
            const tag = el.tagName.toLowerCase();
            return el.getAttribute('role') || (tag === 'a' ? 'link' : tag);
          };
          const labelFor = (el) => {
            return (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.href || roleFor(el))
              .replace(/\\s+/g, ' ')
              .trim()
              .slice(0, 90);
          };
          const nodes = [...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[onclick]')]
            .filter(visible)
            .slice(0, 48);
          return JSON.stringify(nodes.map((el, index) => {
            const rect = el.getBoundingClientRect();
            return {
              id: index,
              role: roleFor(el),
              label: labelFor(el),
              selector: cssPath(el),
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2)
            };
          }));
        })();
        """
        evaluateAgentScript("Inspecting controls", script: script) { [weak self] result in
            guard let self else { return }
            if let json = result as? String,
               let data = json.data(using: .utf8),
               let elements = try? JSONDecoder().decode([BrowserAgentElement].self, from: data) {
                agentElements = elements
                agentStatus = "Found \(elements.count) visible controls"
            } else {
                agentStatus = "Could not inspect this page"
            }
        }
    }

    func clickAgentSelector(_ selector: String? = nil) {
        let target = selector ?? agentSelector
        guard !target.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            agentStatus = "Add a selector or inspect page controls first"
            return
        }

        let selectorValue = javaScriptString(target)
        let script = """
        (() => {
          const el = document.querySelector(\(selectorValue));
          if (!el) return 'No element matched \(selectorValue)';
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          for (const type of ['pointerover','mouseover','pointermove','mousemove','pointerdown','mousedown','pointerup','mouseup','click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
          }
          if (typeof el.click === 'function') el.click();
          return 'Clicked ' + \(selectorValue);
        })();
        """
        evaluateAgentScript("Clicking", script: script)
    }

    func focusAgentSelector() {
        let selectorValue = javaScriptString(agentSelector)
        let script = """
        (() => {
          const el = document.querySelector(\(selectorValue));
          if (!el) return 'No element matched \(selectorValue)';
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.focus();
          return 'Focused ' + \(selectorValue);
        })();
        """
        evaluateAgentScript("Focusing", script: script)
    }

    func typeAgentText() {
        let selectorValue = javaScriptString(agentSelector)
        let textValue = javaScriptString(agentText)
        let script = """
        (() => {
          const el = document.querySelector(\(selectorValue)) || document.activeElement;
          if (!el) return 'No input is focused';
          el.focus();
          const value = \(textValue);
          if ('value' in el) {
            el.value = value;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            el.textContent = value;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          }
          return 'Typed ' + value.length + ' characters';
        })();
        """
        evaluateAgentScript("Typing", script: script)
    }
}
