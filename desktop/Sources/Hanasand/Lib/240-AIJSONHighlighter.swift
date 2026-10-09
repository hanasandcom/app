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

enum AIJSONHighlighter {
    static func highlight(_ json: String, theme: DesktopTheme) -> AttributedString {
        var output = AttributedString("")
        var index = json.startIndex

        while index < json.endIndex {
            let character = json[index]
            if character == "\"" {
                let tokenStart = index
                index = json.index(after: index)
                var escaped = false
                while index < json.endIndex {
                    let next = json[index]
                    index = json.index(after: index)
                    if escaped {
                        escaped = false
                    } else if next == "\\" {
                        escaped = true
                    } else if next == "\"" {
                        break
                    }
                }
                let token = String(json[tokenStart..<index])
                output += colored(token, isObjectKey(after: index, in: json) ? keyColor(theme) : theme.green)
            } else if character.isNumber || character == "-" {
                let tokenStart = index
                index = json.index(after: index)
                while index < json.endIndex,
                      "0123456789.eE+-".contains(json[index]) {
                    index = json.index(after: index)
                }
                output += colored(String(json[tokenStart..<index]), numberColor(theme))
            } else if let keyword = keyword(at: index, in: json) {
                let end = json.index(index, offsetBy: keyword.count)
                output += colored(keyword, theme.accent)
                index = end
            } else if "{}[]:,".contains(character) {
                output += colored(String(character), theme.text)
                index = json.index(after: index)
            } else {
                output += colored(String(character), theme.textSecondary)
                index = json.index(after: index)
            }
        }

        return output
    }

    static func isObjectKey(after tokenEnd: String.Index, in json: String) -> Bool {
        var cursor = tokenEnd
        while cursor < json.endIndex {
            let character = json[cursor]
            if character == ":" {
                return true
            }
            if character == " " || character == "\t" || character == "\n" || character == "\r" {
                cursor = json.index(after: cursor)
                continue
            }
            return false
        }
        return false
    }

    static func keyword(at index: String.Index, in json: String) -> String? {
        for keyword in ["true", "false", "null"] where json[index...].hasPrefix(keyword) {
            return keyword
        }
        return nil
    }

    static func keyColor(_ theme: DesktopTheme) -> Color {
        theme.isLight ? Color(red: 0.82, green: 0.10, blue: 0.42) : Color(red: 1.00, green: 0.24, blue: 0.56)
    }

    static func numberColor(_ theme: DesktopTheme) -> Color {
        theme.isLight ? Color(red: 0.58, green: 0.30, blue: 0.86) : Color(red: 0.74, green: 0.46, blue: 1.00)
    }

    static func colored(_ text: String, _ color: Color) -> AttributedString {
        var attributed = AttributedString(text)
        attributed.foregroundColor = color
        return attributed
    }
}
