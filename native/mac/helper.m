// Apple Silicon companion. JSON lines on stdin/stdout match the Electron bridge.
#import <AudioToolbox/AudioToolbox.h>
#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <CoreAudio/CoreAudio.h>
#import <ifaddrs.h>
#import <net/if.h>
#import <mach/mach.h>
#import <unistd.h>

static void emit(NSDictionary *event) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
    if (data) { fwrite(data.bytes, 1, data.length, stdout); puts(""); fflush(stdout); }
}
static NSString *player;
static BOOL netEnabled, bannersEnabled;
static NSMutableDictionary *scripts, *cooldowns;
static NSAppleEventDescriptor *run(NSString *source) {
    NSAppleScript *script = scripts[source];
    if (!script) { script = [[NSAppleScript alloc] initWithSource:source]; if (scripts.count < 16) scripts[source] = script; }
    NSDictionary *error;
    NSAppleEventDescriptor *result = [script executeAndReturnError:&error];
    if (!result && error) emit(@{@"type":@"diag", @"msg":error[NSAppleScriptErrorMessage] ?: @"Automation unavailable"});
    return result;
}
static void media(void) {
    NSDictionary *chosen = nil;
    for (NSString *identifier in @[@"com.apple.Music", @"com.spotify.client"]) {
        if (![NSRunningApplication runningApplicationsWithBundleIdentifier:identifier].count ||
            [cooldowns[identifier] timeIntervalSinceNow] > 0) continue;
        NSString *source = [NSString stringWithFormat:@"with timeout of 2 seconds\ntell application id \"%@\"\nif player state is stopped then return {}\nset t to current track\nreturn {name of t, artist of t, album of t, duration of t, player position, player state is playing}\nend tell\nend timeout", identifier];
        NSAppleEventDescriptor *r = run(source);
        if (!r) { cooldowns[identifier] = [NSDate dateWithTimeIntervalSinceNow:60]; continue; }
        if (r.numberOfItems != 6) continue;
        NSString *title = [r descriptorAtIndex:1].stringValue ?: @"";
        NSString *artist = [r descriptorAtIndex:2].stringValue ?: @"";
        double duration = [r descriptorAtIndex:4].doubleValue / ([identifier containsString:@"spotify"] ? 1000 : 1);
        BOOL playing = [r descriptorAtIndex:6].booleanValue;
        if (!chosen || playing || [identifier isEqual:player]) chosen = @{@"type":@"media", @"active":@YES, @"title":title, @"artist":artist, @"album":[r descriptorAtIndex:3].stringValue ?: @"", @"duration":@(duration), @"position":@([r descriptorAtIndex:5].doubleValue), @"playing":@(playing), @"canSeek":@YES, @"app":identifier, @"key":[@[identifier,artist,title] componentsJoinedByString:@"|"], @"posSource":@"app"};
        if (playing) break;
    }
    player = chosen[@"app"];
    static NSDictionary *lastMedia;
    NSDictionary *sample = chosen ?: @{@"type":@"media", @"active":@NO};
    if (![sample isEqual:lastMedia]) emit(sample);
    if (chosen && ![chosen[@"key"] isEqual:lastMedia[@"key"]]) {
        NSData *cover = nil;
        if ([player isEqual:@"com.apple.Music"]) {
            cover = run(@"tell application id \"com.apple.Music\" to get raw data of artwork 1 of current track").data;
        }
        NSString *url = nil;
        CGImageSourceRef source = cover.length ? CGImageSourceCreateWithData((__bridge CFDataRef)cover,NULL) : NULL;
        if (source) {
            NSDictionary *options = @{(__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways:@YES, (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize:@256};
            CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source,0,(__bridge CFDictionaryRef)options);
            if (image) {
                NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
                NSData *jpeg = [rep representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor:@0.84}];
                if (jpeg) url = [@"data:image/jpeg;base64," stringByAppendingString:[jpeg base64EncodedStringWithOptions:0]];
                CGImageRelease(image);
            }
            CFRelease(source);
        }
        emit(@{@"type":@"art", @"key":chosen[@"key"], @"data":url ?: NSNull.null});
    }
    lastMedia = sample;
}
static AudioDeviceID device(void) {
    AudioDeviceID output = 0; UInt32 size = sizeof(output);
    AudioObjectPropertyAddress a = {kAudioHardwarePropertyDefaultOutputDevice,kAudioObjectPropertyScopeGlobal,0};
    AudioObjectGetPropertyData(kAudioObjectSystemObject,&a,0,NULL,&size,&output); return output;
}
static void systemSample(void) {
    AudioDeviceID d = device();
    AudioObjectPropertyAddress a = {kAudioHardwareServiceDeviceProperty_VirtualMainVolume,kAudioDevicePropertyScopeOutput,0};
    Float32 volume = -1; UInt32 size = sizeof(volume);
    AudioObjectGetPropertyData(d,&a,0,NULL,&size,&volume);
    UInt32 mute = 0; a.mSelector = kAudioDevicePropertyMute; size = sizeof(mute);
    AudioObjectGetPropertyData(d,&a,0,NULL,&size,&mute);
    CFStringRef name = NULL; size = sizeof(name); a.mSelector = kAudioObjectPropertyName; a.mScope = kAudioObjectPropertyScopeGlobal;
    AudioObjectGetPropertyData(d,&a,0,NULL,&size,&name);
    TISInputSourceRef input = TISCopyCurrentKeyboardInputSource();
    NSArray *languages = input ? (__bridge NSArray *)TISGetInputSourceProperty(input,kTISPropertyInputSourceLanguages) : nil;
    NSDictionary *state = @{@"type":@"system", @"volume":@(lround(volume*100)), @"muted":@(mute != 0), @"caps":@(([NSEvent modifierFlags] & NSEventModifierFlagCapsLock) != 0), @"lang":languages.firstObject ?: @"", @"device":CFBridgingRelease(name) ?: @""};
    if (input) CFRelease(input);
    static NSDictionary *last;
    if (![state isEqual:last]) { emit(state); last = state; }
}
static void stats(void) {
    struct mach_task_basic_info m; mach_msg_type_number_t n = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(),MACH_TASK_BASIC_INFO,(task_info_t)&m,&n)==KERN_SUCCESS) emit(@{@"type":@"mem",@"ws":@(m.resident_size)});
    if (!netEnabled) return;
    struct ifaddrs *head; if (getifaddrs(&head)) return;
    uint64_t rx=0, tx=0;
    for (struct ifaddrs *p=head; p; p=p->ifa_next) {
        if (!p->ifa_addr || p->ifa_addr->sa_family != AF_LINK || !p->ifa_data || (p->ifa_flags & IFF_LOOPBACK)) continue;
        struct if_data *data=p->ifa_data; rx+=data->ifi_ibytes; tx+=data->ifi_obytes;
    }
    freeifaddrs(head); emit(@{@"type":@"net",@"rx":@(rx),@"tx":@(tx)});
}
static id attribute(AXUIElementRef e, CFStringRef key) {
    CFTypeRef value=NULL;
    if (AXUIElementCopyAttributeValue(e,key,&value)!=kAXErrorSuccess) return nil;
    return CFBridgingRelease(value);
}
// Only inspect the visible banner subtree. Never enumerate notification history.
static void inspectNode(AXUIElementRef element, BOOL banner, int depth, int *budget, NSMutableArray *text) {
    if (depth>9 || --*budget<0) return;
    NSString *identifier=attribute(element,kAXIdentifierAttribute);
    NSString *subrole=attribute(element,kAXSubroleAttribute);
    banner |= [identifier.lowercaseString containsString:@"banner"] || [subrole.lowercaseString containsString:@"banner"];
    if (banner && [attribute(element,kAXRoleAttribute) isEqual:@"AXStaticText"]) {
        id value=attribute(element,kAXValueAttribute);
        if ([value isKindOfClass:NSString.class] && [value length] && text.count<8) [text addObject:value];
    }
    for (id child in attribute(element,kAXChildrenAttribute)) {
        if (*budget<=0) break;
        inspectNode((__bridge AXUIElementRef)child,banner,depth+1,budget,text);
    }
}
static void accessibilitySample(void) {
    static NSInteger status=-1;
    BOOL trusted=AXIsProcessTrusted();
    if (status!=trusted) { status=trusted; emit(@{@"type":@"toasts-status",@"ok":@(trusted),@"error": trusted ? @"" : @"Allow Atoll in Privacy & Security → Accessibility"}); }
    if (!trusted) return;
    NSRunningApplication *front=NSWorkspace.sharedWorkspace.frontmostApplication;
    if (front && ![front.bundleIdentifier isEqual:@"app.atoll.notch"]) {
        AXUIElementRef owner=AXUIElementCreateApplication(front.processIdentifier);
        AXUIElementSetMessagingTimeout(owner,0.2);
        id focused=attribute(owner,kAXFocusedWindowAttribute);
        BOOL full=focused && [attribute((__bridge AXUIElementRef)focused,CFSTR("AXFullScreen")) boolValue];
        static BOOL wasFull;
        if (wasFull!=full) { emit(@{@"type":@"fullscreen",@"on":@(full)}); wasFull=full; }
        CFRelease(owner);
    }
    if (!bannersEnabled) return;
    NSRunningApplication *center=[NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.notificationcenterui"].firstObject;
    if (!center) return;
    AXUIElementRef app=AXUIElementCreateApplication(center.processIdentifier);
    AXUIElementSetMessagingTimeout(app,0.2);
    NSMutableSet *visible=[NSMutableSet set];
    static NSSet *previous;
    for (id window in attribute(app,kAXWindowsAttribute)) {
        NSMutableArray *lines=[NSMutableArray array]; int budget=90;
        inspectNode((__bridge AXUIElementRef)window,NO,0,&budget,lines);
        if (!lines.count) continue;
        NSString *key=[lines componentsJoinedByString:@"\n"]; [visible addObject:key];
        if (![previous containsObject:key]) emit(@{@"type":@"toast",@"title":lines.firstObject,@"body":[[lines subarrayWithRange:NSMakeRange(1,lines.count-1)] componentsJoinedByString:@"\n"],@"attribution":@"Notification Center"});
    }
    previous=visible; CFRelease(app);
}
static void command(NSDictionary *message) {
    NSString *cmd=message[@"cmd"];
    if ([cmd isEqual:@"toasts"]) bannersEnabled=[message[@"on"] boolValue];
    if ([cmd isEqual:@"net"]) netEnabled=[message[@"on"] boolValue];
    if ([cmd isEqual:@"paste"] && CGPreflightPostEventAccess()) {
        for (int down=1;down>=0;down--) { CGEventRef e=CGEventCreateKeyboardEvent(NULL,9,down); CGEventSetFlags(e,kCGEventFlagMaskCommand); CGEventPost(kCGHIDEventTap,e); CFRelease(e); }
    }
    if ([cmd isEqual:@"setvol"]) {
        Float32 value=MIN(1,MAX(0,[message[@"v"] floatValue]/100));
        AudioObjectPropertyAddress a={kAudioHardwareServiceDeviceProperty_VirtualMainVolume,kAudioDevicePropertyScopeOutput,0};
        AudioObjectSetPropertyData(device(),&a,0,NULL,sizeof(value),&value);
    }
    NSString *action=@{@"prev":@"previous track",@"next":@"next track",@"toggle":@"playpause"}[cmd];
    if ([cmd isEqual:@"seek"]) action=[NSString stringWithFormat:@"set player position to %.3f",MAX(0,[message[@"pos"] doubleValue])];
    if (action && player && [NSRunningApplication runningApplicationsWithBundleIdentifier:player].count) {
        run([NSString stringWithFormat:@"tell application id \"%@\" to %@",player,action]); media();
    }
}
int main(void) { @autoreleasepool {
    scripts=[NSMutableDictionary dictionary]; cooldowns=[NSMutableDictionary dictionary];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{
        char *line=NULL; size_t cap=0;
        while (getline(&line,&cap,stdin)>0) { @autoreleasepool {
            NSData *data=[[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];
            NSDictionary *msg=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if ([msg isKindOfClass:NSDictionary.class]) dispatch_async(dispatch_get_main_queue(), ^{command(msg);});
        } }
        free(line); exit(0);
    });
    emit(@{@"type":@"ready"});
    __block NSInteger changes=NSPasteboard.generalPasteboard.changeCount;
    __block unsigned tick=0;
    [NSTimer scheduledTimerWithTimeInterval:0.5 repeats:YES block:^(NSTimer *timer){ @autoreleasepool {
        NSInteger current=NSPasteboard.generalPasteboard.changeCount;
        if (changes!=current) { changes=current; emit(@{@"type":@"clip"}); }
        systemSample();
        if (!(tick%2)) { media(); accessibilitySample(); }
        if (!(tick%4)) stats();
        tick++;
    }}];
    [[NSRunLoop mainRunLoop] run];
} return 0; }
