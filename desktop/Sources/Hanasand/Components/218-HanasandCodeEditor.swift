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

struct HanasandCodeEditor: NSViewRepresentable {
    @Binding var text: String
    let highlightedLine: Int?

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = false
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false

        let textView = NSTextView()
        textView.isRichText = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.allowsUndo = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .semibold)
        textView.textColor = NSColor.labelColor
        textView.backgroundColor = .clear
        textView.insertionPointColor = NSColor.systemOrange
        textView.string = text
        textView.delegate = context.coordinator
        textView.textContainerInset = NSSize(width: 12, height: 12)
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = true
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)

        scrollView.documentView = textView
        context.coordinator.textView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = context.coordinator.textView else { return }
        if textView.string != text {
            textView.string = text
        }
        context.coordinator.applyHighlight(line: highlightedLine)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var text: String
        weak var textView: NSTextView?
        var lastHighlightedLine: Int?

        init(text: Binding<String>) {
            _text = text
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            text = textView.string
        }

        func applyHighlight(line: Int?) {
            guard let textView else { return }
            let fullRange = NSRange(location: 0, length: (textView.string as NSString).length)
            textView.textStorage?.removeAttribute(.backgroundColor, range: fullRange)
            guard let line else {
                lastHighlightedLine = nil
                return
            }
            let range = characterRange(for: line, in: textView.string)
            guard range.location != NSNotFound else { return }
            textView.textStorage?.addAttribute(.backgroundColor, value: NSColor.systemOrange.withAlphaComponent(0.28), range: range)
            if lastHighlightedLine != line {
                textView.scrollRangeToVisible(range)
                lastHighlightedLine = line
            }
        }

        func characterRange(for targetLine: Int, in text: String) -> NSRange {
            let nsText = text as NSString
            let lines = text.components(separatedBy: .newlines)
            guard targetLine >= 1, targetLine <= max(lines.count, 1) else {
                return NSRange(location: NSNotFound, length: 0)
            }
            var location = 0
            for index in 0..<(targetLine - 1) {
                location += (lines.indices.contains(index) ? lines[index].count : 0) + 1
            }
            let length = max(1, lines.indices.contains(targetLine - 1) ? lines[targetLine - 1].count : 0)
            return NSRange(location: min(location, nsText.length), length: min(length, max(0, nsText.length - location)))
        }
    }
}
