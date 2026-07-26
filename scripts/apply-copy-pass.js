/** Targeted user-facing copy fixes. Does not touch auth/query logic. */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

var files = [
  'index.html', 'dashboard.html', 'browsetask.html', 'posttask.html', 'mytasks.html',
  'login.html', 'signup.html', 'messages.html', 'chat.html', 'review.html',
  'profile.html', 'modeselector.html', 'feedback.html', 'qg-role-switch.js', 'qg-config.js'
];

var replacements = [
  [/browse gigs/gi, 'browse tasks'],
  [/Browse gigs/g, 'Browse tasks'],
  [/Explore gigs/g, 'Explore tasks'],
  [/My jobs/g, 'My tasks'],
  [/active job/g, 'active task'],
  [/active jobs/g, 'active tasks'],
  [/Find work/g, 'Find tasks'],
  [/Gigs near you/g, 'Tasks near you'],
  [/No gigs posted nearby yet — check back soon/g, 'No tasks nearby yet — post one or widen your area'],
  [/skilled workers/gi, 'skilled taskers'],
  [/nearby worker/gi, 'nearby tasker'],
  [/Workers apply/g, 'Taskers apply'],
  [/other people's gigs/g, "other people's tasks"],
  [/other people\'s gigs/g, "other people's tasks"],
  [/Available for gigs/g, 'Available for tasks'],
  [/great at gigs/gi, 'great at tasks'],
  [/Submit your offer to the poster/g, 'Send your offer to the poster'],
  [/Application sent! You'll hear back soon 🎉/g, 'Application sent. You will hear back soon.'],
  [/Application sent!/g, 'Application sent.'],
  [/Task posted!/g, 'Task posted'],
  [/Review submitted!/g, 'Review submitted'],
  [/Submit review/g, 'Post review'],
  [/Submit feedback/g, 'Send feedback'],
  [/Profile saved! 🎉/g, 'Saved'],
  [/Saved! 🎉/g, 'Saved'],
  [/Thank you!/g, 'Thank you'],
  [/Password reset email sent!/g, 'Password reset email sent'],
  [/Account created!/g, 'Account created'],
  [/You're almost in!/g, "You're almost in"],
  [/Almost there!/g, 'Almost there'],
  [/Sign up first!/g, 'Sign up first'],
  [/Please select a category/g, 'Select a category'],
  [/Please add a title/g, 'Add a title'],
  [/Please choose a time/g, 'Choose a time'],
  [/Please choose a date/g, 'Choose a date'],
  [/Please enter your full name/g, 'Enter your full name'],
  [/Please enter a valid email/g, 'Enter a valid email'],
  [/Please enter your email/g, 'Enter your email'],
  [/Please enter your phone/g, 'Enter your phone'],
  [/Please agree to the Terms/g, 'Agree to the Terms'],
  [/Please try again/g, 'Try again'],
  [/Please log in again/g, 'Log in again'],
  [/Please fix the highlighted fields above\./g, 'Fix the highlighted fields above.'],
  [/Please leave a review on completed jobs/g, 'Leave a review on completed tasks'],
  [/see the job before they apply/g, 'see the task before they apply'],
  [/confirm the job is done/g, 'confirm the task is done'],
  [/Share job or progress photos/g, 'Share task or progress photos'],
  [/after every job/g, 'after every task'],
  [/Jobs you applied to/g, 'Tasks you applied to'],
  [/the job moves to In Progress/g, 'the task moves to In Progress'],
  [/No tasks posted yet — be the first!/g, 'No open tasks yet — post the first one'],
  [/Could not send message\. Please try again\./g, 'Could not send message. Check your connection and try again.'],
  [/Something went wrong\. Please try again/g, 'Something went wrong. Try again'],
  [/You're in Tasker mode — browse gigs and apply\./g, "You're in Tasker mode — browse tasks and apply."],
  [/browse gigs and apply/gi, 'browse tasks and apply'],
  [/\$\{nearby\} gig/g, '${nearby} task'],
  [/gig' \+ \(nearby !== 1 \? 's' : ''\)/g, "task' + (nearby !== 1 ? 's' : '')"],
  [/My jobs →/g, 'My tasks →'],
  [/Canada’s/g, "Canada's"],
  [/you'll/g, "you'll"],
  [/Submitting\.\.\./g, 'Sending review…'],
  [/Loading tasks\.\.\./g, 'Loading tasks…']
];

files.forEach(function (file) {
  var fp = path.join(root, file);
  if (!fs.existsSync(fp)) return;
  var html = fs.readFileSync(fp, 'utf8');
  var before = html;
  replacements.forEach(function (pair) {
    html = html.replace(pair[0], pair[1]);
  });
  if (html !== before) {
    fs.writeFileSync(fp, html);
    console.log('copy-fixed', file);
  } else {
    console.log('unchanged', file);
  }
});
