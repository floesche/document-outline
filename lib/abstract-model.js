'use babel';
import {Point, Range, Emitter, CompositeDisposable} from 'atom';

const MAX_HEADING_DEPTH = 4;

function lineNumberByIndex(index, string) {
  // RegExp
  let line = 0;
  let match;
  let re = /(^)[\S\s]/gm;
  while ((match = re.exec(string))) {
    if (match.index > index)
      break;
    line++;
  }
  return line;
}

export default class AbstractModel {
  // NOTE: if it was possible to simply scan through applied scopes, wouldn't need most of this...
  constructor(editorOrBuffer, headingRegexes) {
    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable();
    this.HEADING_REGEX = headingRegexes;

    if (editorOrBuffer.getBuffer) {
      this.buffer = editorOrBuffer.getBuffer();
      this.editor = editorOrBuffer;
    } else {
      this.buffer = editorOrBuffer;
      this._editor = null;
    }

    // this.headingMarkerLayer = this.buffer.addMarkerLayer({maintainHistory: false});
    this.sectionMarkerLayer = this.buffer.addMarkerLayer({maintainHistory: false});

    // NOTE: don't store the headings in the model because it seems to cause memory leak issues.
    // this.headings = [];

    this.subscriptions.add(this.emitter.on('did-error', err => {
      console.log(err);
    }));

    atom.config.observe('document-outline.maxHeadingDepth', newValue => {
      // Make sure we don't call update if nothing has changed.
      // Important if we want to do more setup in subclasses before update is called
      if (newValue) {
        this.maxDepth = newValue;
        this.update();
      }
    });

    this.maxDepth = atom.config.get("document-outline.maxHeadingDepth");
    if (!this.maxDepth) {
      this.maxDepth = MAX_HEADING_DEPTH;
    }
    // NOTE: Don't call update or parse, let subclasses do that
  }

  onDidUpdate(callback) {
    return this.emitter.on('did-update', callback);
  }
  onDidError(callback) {
    return this.emitter.on('did-error', callback);
  }

  destroy() {
    this.subscriptions.dispose();
    // this.headingMarkerLayer.destroy();
  }

  update() {
    let headings = this.parse();
    this.emitter.emit("did-update", headings);
  }

  parse() {
    return this._parseLevel(Point.ZERO, Point.INFINITY, 1);
  }

  // abstact getRegexData(scanResult)

  /**
   * @param {List} rawHeadings - raw list of heading objects from parser
   * @return {List} - headings nested according to their level
   */
  _stackHeadings(rawHeadings) {
    let stack = [{
      level: 0,
      label: '_hidden_root',
      headingRange: new Range(Point.ZERO, Point.INFINITY),
      children: [],
      range: new Range(Point.ZERO, Point.INFINITY)
    }];
    let top;
    for (let heading of rawHeadings) {
      if (heading.level > this.maxDepth) {
        continue;
      }
      top = stack.pop();
      if (heading.level > top.level) {
        top.children.push(heading);
        stack.push(top);
        stack.push(heading);
      } else if (heading.level === top.level) {
        // At equal level, we close the previous heading
        top.range.end = heading.headingRange.start;
        top.range.end.row -= 1;
        // Then get the parent
        top = stack.pop();
        top.children.push(heading);
        stack.push(top);
        stack.push(heading);
      } else if (top.level > heading.level) {
        // This starts a new section at a more important level
        // roll up the stack
        top.range.end = heading.headingRange.start;
        top.range.end.row -= 1;
        while (top) {
          top = stack.pop();
          // Close each range until we get to the suitable parent
          top.range.end = heading.headingRange.start;
          top.range.end.row -= 1;
          if (top.level < heading.level) {
            break;
          }
        }
        top.children.push(heading);
        stack.push(top);
        stack.push(heading);
      }
    }
    return stack[0].children;
  }

  // NOTE possibly replace Atom's scan in range with home-rolled parser.
  // looks like JS regex should return line numbers
  _parseLevel(start, end, level) {
    let rawHeadings = [];
    let regex = this.HEADING_REGEX;

    let text = this.buffer.getText();

    let result;
    let parsedResult;
    while ((result = regex.exec(text)) !== null) {
      parsedResult = this.getRegexData(result);

      let startLine = lineNumberByIndex(result.index, text);
      let headingRange = new Range([startLine, 0], [startLine, parsedResult.label.length]);
      let heading = {
        level: parsedResult.level,
        headingRange: headingRange,
        label: parsedResult.label,
        children: [],
        range: new Range(headingRange.start, Point.INFINITY)
      };
      rawHeadings.push(heading);
    }

    // this.buffer.scanInRange(regex, new Range(start, end), scanResult => {
    //   // allow subclasses to customise how they get level, lable from regex
    //   let res = this.getRegexData(scanResult);
    //   let heading = {
    //     level: res.level,
    //     headingRange: scanResult.range,
    //     label: res.label,
    //     children: [],
    //     range: new Range(scanResult.range.start, Point.INFINITY)
    //   };
    //   rawHeadings.push(heading);
    // });

    return this._stackHeadings(rawHeadings);
  }

}
