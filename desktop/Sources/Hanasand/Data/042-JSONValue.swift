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

enum JSONValue: Decodable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .null
        }
    }

    var pretty: String {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            return value.rounded() == value ? String(Int(value)) : String(value)
        case .bool(let value):
            return value ? "true" : "false"
        case .object(let value):
            let lines = value.sorted { $0.key < $1.key }.map { key, child in "\(key): \(child.pretty)" }
            return lines.joined(separator: "\n")
        case .array(let value):
            return value.map(\.pretty).joined(separator: "\n")
        case .null:
            return "null"
        }
    }

    func numberValue(for path: [String]) -> Double? {
        guard let head = path.first else {
            if case .number(let value) = self { return value }
            return nil
        }
        guard case .object(let object) = self, let child = object[head] else {
            return nil
        }
        return child.numberValue(for: Array(path.dropFirst()))
    }
}
