'use strict';

// Node modules
const Cheerio = require('cheerio');
const Fs = require('fs');
const He = require('he');
const Moment = require('moment');
const Path = require('path');
const Striptags = require('striptags');
const Trim = require('trim');
const TruncateHtml = require('truncate-html');

// Local modules
const SignedUrl = require(Path.join(__basedir, 'source/modules/signed_url.js'));
const Slug = require(Path.join(__basedir, 'source/modules/slug.js'));

module.exports = (dust) => {

  //
  // Outputs one or more classes that should be applied to the <body> element.
  //
  // Examples:
  //
  //  {@bodyClass/}
  //
  dust.helpers.bodyClass = (chunk, context) => {
    const locals = context.options.locals;
    let template = context.options.view.name;
    let bodyClass = '';

    // Remove .dust and convert the template name a slug
    template = Slug(template.replace(/\.dust$/, ''));

    // Template class
    bodyClass += 'template-' + template;

    // Homepage class
    if(locals.Request.isHomepage) {
      bodyClass += ' page-homepage';
    }

    // Pagination class
    if(locals.pagination) {
      bodyClass += ' page-' + locals.pagination.currentPage;
    }

    return chunk.write(bodyClass);
  };

  //
  // Outputs the post content. If no post is specified, the current post context will be used.
  //
  // Examples:
  //
  //  {@content/}
  //  {@content editable="true"/}
  //
  dust.helpers.content = (chunk, context, bodies, params) => {
    let isEditor = context.options.locals.isEditor;
    let editable = (context.resolve(params.editable) + '') === 'true';
    let post = context.resolve(params.post);
    let content = post ? post.content : context.get('content') || '';

    // Add editable wrappers when the post is being rendered in the editor
    if(isEditor && editable) {
      content = `
        <div
          data-postleaf-region="content"
          data-postleaf-html="` + He.encode(content, { useNamedReferences: true }) + `"
        >
          ` + content + `
        </div>
      `;
    }

    return chunk.write(content);
  };

  //
  // Generates a signed URL for a dynamic image.
  //
  // Examples:
  //
  //  {@dynamicImage src="/uploads/2017/03/image.jpg" width="100"/}
  //  {@dynamicImage src="/uploads/2017/03/image.jpg" grayscale="true" blur="10" rotate="90"/}
  //
  dust.helpers.dynamicImage = (chunk, context, bodies, params) => {
    let src = context.resolve(params.src);
    let query = [];

    // Don't modify full-qualified URLs or hashes
    if(typeof src === 'string' && src.match(/^(http|https|mailto|#):/i)) {
      return chunk.write(src);
    }

    // Build the query string
    Object.keys(params).forEach((key) => {
      if(key !== 'src') {
        query.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
      }
    });

    // Generate a signed URL
    return chunk.write(
      SignedUrl.sign(src + '?' + query.join('&'), process.env.AUTH_SECRET)
    );
  };

  //
  // Generates an excerpt. If no content is specified, the current post context will be used.
  //
  // Examples:
  //
  //  {@excerpt/}
  //  {@excerpt content="<p>...</p>" paragraphs="2" words="50" tags="a,em,strong"/}
  //
  dust.helpers.excerpt = (chunk, context, bodies, params) => {
    let content = context.resolve(params.content) || context.get('content') || '';
    let paragraphs = context.resolve(params.paragraphs) || 1;
    let words = parseInt(context.resolve(params.words));
    let tags = context.resolve(params.tags) || 'a,abbr,b,bdi,bdo,blockquote,br,cite,code,data,dd,del,dfn,dl,dt,em,i,ins,kbd,li,mark,ol,p,pre,q,rp,rt,rtc,ruby,s,samp,small,span,strong,sub,sup,time,u,ul,var,wbr';
    let $ = Cheerio.load(content);
    let excerpt = '';

    // Get paragraphs from content (top level matches only)
    let p = $('p:not(* > p)').slice(0, paragraphs);

    // Concatenate matching paragraphs
    $(p).each((index, el) => {
      excerpt += '<p>' + $(el).html() + '</p>';
    });

    // Truncate by words
    if(words) {
      excerpt = TruncateHtml(excerpt, words, {
        byWords: true,
        ellipsis: '…'
      });
    }

    // Strip disallowed tags
    if(tags) {
      excerpt = Striptags(excerpt, tags.split(',').map((val) => Trim(val)));
    }

    return chunk.write(excerpt);
  };

  //
  // Outputs required foot data.
  //
  // Examples:
  //
  //  {@foot/}
  //
  dust.helpers.foot = (chunk, context) => {
    // Async wrapper
    return chunk.map((chunk) => {
      const locals = context.options.locals;
      const MakeUrl = require(Path.join(__basedir, 'source/modules/make_url.js'))(locals.Settings);

      let isEditor = context.options.locals.isEditor;
      let toolbar = Path.join(__basedir, 'source/views/partials/theme_toolbar.dust');
      let script = MakeUrl.raw('assets/js/tinymce.bundle.js');
      let html = '';

      // Editor scripts
      if(isEditor) {
        html += `
          <script
            data-postleaf-editor="scripts"
            src="` + He.encode(script, { useNamedReferences: true }) + `"
          ></script>
        `;
      }

      // Inject foot code
      html += locals.Settings.footCode || '';
      html += '\n';

      // Render the theme toolbar partial
      if(locals.User) {
        chunk.partial(toolbar, context).end();
      }

      chunk.write(html);

      return chunk.end();
    });
  };

  //
  // Gets one or more authors.
  //
  // Examples:
  //
  //  {@getAuthors count="10" offset="0" sortBy="name" sortOrder="desc"}
  //    {#authors}
  //      {name} {email}
  //    {:else}
  //      No authors
  //    {/authors}
  //  {/getAuthors}
  //
  dust.helpers.getAuthors = (chunk, context, bodies, params) => {
    // Async wrapper
    return chunk.map((chunk) => {
      const locals = context.options.locals;
      const models = locals.Database.sequelize.models;
      let id = context.resolve(params.id);
      let email = context.resolve(params.email);
      let username = context.resolve(params.username);
      let sortBy = context.resolve(params.sortBy);
      let sortOrder = context.resolve(params.sortOrder);
      let count = context.resolve(params.count);
      let offset = context.resolve(params.offset);

      // Resolve all params
      for(let key in params) {
        params[key] = context.resolve(params[key]);
      }

      // Filter by attributes
      let where = {};
      if(id) where.id = { $in: id.split(',').map(Trim) };
      if(email) where.email = { $in: email.split(',').map(Trim) };
      if(username) where.username = { $in: username.split(',').map(Trim) };

      // Sort
      sortBy = (sortBy || '').match(/^(id|name|email|username|createdAt)$/) ? sortBy : 'name';
      sortOrder = (sortOrder || '').match(/^(asc|desc)$/) ? sortOrder.toUpperCase() : 'ASC';

      // Fetch authors
      models.user
        .findAll({
          where: where,
          offset: offset || 0,
          limit: count || 10,
          order: [
            [sortBy, sortOrder]
          ]
        })
        .then((authors) => {
          // Render the block with the authors context
          chunk = bodies.block(chunk, context.push({ authors: authors }));

          return chunk.end();
        })
        .catch(() => chunk.end());
    });
  };

  //
  // Parses HTML content and returns elements that match the specified selector. Useful for many
  // purposes, including finding an image to display as a visual excerpt or parsing elements or
  // attributes. If no content is specified, the current post context will be used.
  //
  // Examples:
  //
  //  {@getElements content="<p>...</p>" selector="img" count="1" offset="0"}
  //    {#elements}
  //      Name: {name}
  //      Attr: {attributes.src}
  //      HTML: {html}
  //    {:else}
  //      No matches
  //    {/elements}
  //  {/getElements}
  //
  dust.helpers.getElements = (chunk, context, bodies, params) => {
    let content = context.resolve(params.content) || context.get('content') || '';
    let selector = context.resolve(params.selector) || '*';
    let count = context.resolve(params.count) || 10;
    let offset = context.resolve(params.offset) || 0;
    let $ = Cheerio.load(content);
    let matches = $(selector).slice(offset, count);
    let elements = [];

    // Append each element to the body context
    matches.map((index, element) => {
      elements.push({
        name: element.name,
        attributes: element.attribs,
        html: $.html(element)
      });
    });

    // Render the block with the elements context
    chunk = bodies.block(chunk, context.push({ elements: elements }));

    return chunk;
  };

  //
  // Gets the next post. If no post is specified, the current post context will be used.
  //
  // Examples:
  //
  //  {@getNextPost}
  //    {#post}
  //      {title}
  //    {:else}
  //      No next post
  //    {/post}
  //  {/getNextPost}
  //
  //  {@getNextPost post=post previous="true"} ... {/getNextPost}
  //
  dust.helpers.getNextPost = (chunk, context, bodies, params) => {
    // Async wrapper
    return chunk.map((chunk) => {
      const locals = context.options.locals;
      const models = locals.Database.sequelize.models;
      let post = context.resolve(params.post);
      let previous = (context.resolve(params.previous) + '') === 'true';
      let id = post ? post.id : context.get('id');

      // Fetch the target post
      models.post
        .findOne({
          where: { id: id }
        })
        .then((post) => {
          if(post && typeof post.getNext === 'function') {
            return post.getNext({ previous: previous });
          }

          return null;
        })
        .then((post) => {
          // Render the block with the posts context
          chunk = bodies.block(chunk, context.push({ post: post }));

          return chunk.end();
        })
        .catch(() => chunk.end());
    });
  };

  //
  // Gets one or more posts.
  //
  // Examples:
  //
  //  {@getPosts count="10" offset="0" sortBy="name" sortOrder="desc"}
  //    {#posts}
  //      {title}
  //    {:else}
  //      No posts
  //    {/posts}
  //  {/getPosts}
  //
  dust.helpers.getPosts = (chunk, context, bodies, params) => {
    // Async wrapper
    return chunk.map((chunk) => {
      const locals = context.options.locals;
      const models = locals.Database.sequelize.models;
      let id = context.resolve(params.id);
      let slug = context.resolve(params.slug);
      let sortBy = context.resolve(params.sortBy);
      let sortOrder = context.resolve(params.sortOrder);
      let count = context.resolve(params.count);
      let offset = context.resolve(params.offset);

      // Resolve all params
      for(let key in params) {
        params[key] = context.resolve(params[key]);
      }

      // Filter by attributes
      let where = {};
      if(id) where.id = { $in: id.split(',').map(Trim) };
      if(slug) where.slug = { $in: slug.split(',').map(Trim) };

      // Sort
      sortBy = (sortBy || '').match(/^(id|slug|title|createdAt)$/) ? sortBy : 'title';
      sortOrder = (sortOrder || '').match(/^(asc|desc)$/) ? sortOrder.toUpperCase() : 'ASC';

      // Fetch authors
      models.post
        .findAll({
          where: where,
          include: [
            {
              model: models.user,
              as: 'author',
              attributes: { exclude: ['password', 'resetToken'] }
            },
            {
              model: models.tag,
              through: { attributes: [] }, // exclude postTags
              where: null // also return posts that don't have tags
            }
          ],
          offset: offset || 0,
          limit: count || 10,
          order: [
            [sortBy, sortOrder]
          ]
        })
        .then((posts) => {
          // Render the block with the posts context
          chunk = bodies.block(chunk, context.push({ posts: posts }));

          return chunk.end();
        })
        .catch(() => chunk.end());
    });
  };

  //
  // Gets posts that are related to the source post. If no post is specified, the current post
  // context will be used.
  //
  // Examples:
  //
  //  {@getRelatedPosts}
  //    {#posts}
  //      {title}
  //    {:else}
  //      No related posts
  //    {/posts}
  //  {/getRelatedPosts}
  //
  //  {@getRelatedPosts post=post count="10" offset="0"} ... {/getRelatedPosts}
  //
  dust.helpers.getRelatedPosts = (chunk, context, bodies, params) => {
    // Async wrapper
    return chunk.map((chunk) => {
      const locals = context.options.locals;
      const models = locals.Database.sequelize.models;
      let count = context.resolve(params.count) || 10;
      let offset = context.resolve(params.offset) || 0;
      let post = context.resolve(params.post);
      let id = post ? post.id : context.get('id');

      // Fetch the target post
      models.post
        .findOne({
          where: {
            id: id
          },
          include: [{
            model: models.tag
          }]
        })
        .then((post) => {
          if(!post) return chunk.end();

          // Fetch related posts
          return post.getRelated({
            count: count,
            offset: offset
          });
        })
        .then((posts) => {
          if(!posts) return chunk.end();

          // Render the block with the posts context
          chunk = bodies.block(chunk, context.push({ posts: posts }));

          return chunk.end();
        })
        .catch(() => chunk.end());
    });
  };

  //
  // Gets one or more tags.
  //
  // Examples:
  //
  //  {@getTags slug="favorites"}
  //    {#tags}
  //      {name}
  //    {:else}
  //      No tags
  //    {/tags}
  //  {/getTags}
  //
  //  {@getTags count="10" offset="0" sortBy="name" sortOrder="desc"} ... {/getTags}
  //
  dust.helpers.getTags = (chunk, context, bodies, params) => {
    // Async wrapper
    return chunk.map((chunk) => {
      const locals = context.options.locals;
      const models = locals.Database.sequelize.models;
      let id = context.resolve(params.id);
      let slug = context.resolve(params.slug);
      let sortBy = context.resolve(params.sortBy);
      let sortOrder = context.resolve(params.sortOrder);
      let offset = context.resolve(params.offset);
      let count = context.resolve(params.count);

      // Resolve all params
      for(let key in params) {
        params[key] = context.resolve(params[key]);
      }

      // Filter by attributes
      let where = {};
      if(id) where.id = { $in: id.split(',').map(Trim) };
      if(slug) where.slug = { $in: slug.split(',').map(Trim) };

      // Sort
      sortBy = (sortBy || '').match(/^(id|slug|name|createdAt)$/) ? sortBy : 'name';
      sortOrder = (sortOrder || '').match(/^(asc|desc)$/) ? sortOrder.toUpperCase() : 'ASC';

      // Fetch tags
      models.tag
        .findAll({
          where: where,
          offset: offset || 0,
          limit: count || 10,
          order: [
            [sortBy, sortOrder]
          ]
        })
        .then((tags) => {
          // Render the block with the tags context
          chunk = bodies.block(chunk, context.push({ tags: tags }));

          return chunk.end();
        })
        .catch(() => chunk.end());
    });
  };

  //
  // Outputs required head data.
  //
  // Examples:
  //
  //  {@head/}
  //
  // To disable meta outputs:
  //
  //  {@head jsonLD="false" openGraph="false" twitterCard="false"/}
  //
  dust.helpers.head = (chunk, context, bodies, params) => {
    const locals = context.options.locals;
    const MakeUrl = require(Path.join(__basedir, 'source/modules/make_url.js'))(locals.Settings);

    let isEditor = context.options.locals.isEditor;
    let jsonLD = (context.resolve(params.jsonLD) + '') !== 'false';
    let openGraph = (context.resolve(params.openGraph) + '') !== 'false';
    let twitterCard = (context.resolve(params.twitterCard) + '') !== 'false';
    let meta = context.get('meta') || {};
    let html = '';

    // Inject head code
    html += locals.Settings.headCode || '';
    html += '\n';

    // Generator meta
    html += '<meta name="generator" content="Postleaf">\n';

    // Theme toolbar styles
    if(locals.User) {
      html += `
        <link
          rel="stylesheet"
          href="` + He.encode(MakeUrl.raw('assets/css/theme_toolbar.css')) + `"
        >
      `;
    }

    // Base tag, editor styles, and the Postleaf object
    if(isEditor) {
      html += `
        <base href="` + He.encode(MakeUrl.raw()) + `">
        <link
          data-postleaf-editor="styles"
          rel="stylesheet"
          href="` + He.encode(MakeUrl.raw('assets/css/editor.css')) + `"
        >
        <script>
          window.Postleaf = {
            isEditor: true
          };
        </script>
      `;
    }

    // JSON Linked Data
    if(jsonLD && meta.jsonLD) {
      html += '<script type="application/ld+json">\n';
      html += JSON.stringify(meta.jsonLD, null, 2) + '\n';
      html += '</script>\n';
    }

    // Open Graph data
    if(openGraph && meta.openGraph) {
      for(let i in meta.openGraph) {
        if(meta.openGraph[i]) {
          html +=
            '<meta property="' +
            He.encode(i, { useNamedReferences: true }) +
            '" content="' +
            He.encode(meta.openGraph[i], { useNamedReferences: true }) +
            '">\n';
        }
      }
    }

    // Twitter Card data
    if(twitterCard && meta.twitterCard) {
      for(let i in meta.twitterCard) {
        if(meta.twitterCard[i]) {
          html +=
            '<meta name="' +
            He.encode(i, { useNamedReferences: true }) +
            '" content="' +
            He.encode(meta.twitterCard[i], { useNamedReferences: true }) +
            '">\n';
        }
      }
    }

    return chunk.write(html);
  };

  //
  // Gets the site's navigation.
  //
  // Examples:
  //
  //  {@navigation}
  //    <a class="{?isCurrent}current{/isCurrent}" href="{@url path=link/}">
  //      {label}
  //    </a>
  //  {/navigation}
  //
  dust.helpers.navigation = (chunk, context, bodies) => {
    const locals = context.options.locals;
    let navigation = locals.Navigation;

    if(!navigation.length) {
      // No nav items, do {:else}
      if(bodies['else']) {
        chunk = chunk.render(bodies['else'], context);
      }
      return chunk;
    }

    // Append each element to the body context
    navigation.map((item) => {
      chunk = bodies.block(chunk, context.push({
        label: item.label,
        link: item.link
      }));
    });

    return chunk;
  };

  //
  // Outputs one or more classes that should be applied to posts in your theme. If no post is
  // specified, the current post context will be used.
  //
  // Examples:
  //
  //  {@postClass/}
  //
  dust.helpers.postClass = (chunk, context, bodies, params) => {
    let post = context.resolve(params.post);
    let status = post ? post.status : context.get('status');
    let isPage = post ? post.isPage : context.get('isPage');
    let isFeatured = post ? post.isFeatured : context.get('isFeatured');
    let isSticky = post ? post.isSticky : context.get('isSticky');
    let tags = post ? post.tags : context.get('tags');
    let postClass = 'post';

    // Post status
    if(status) postClass += ' post-status-' + status;

    // Post flags
    if(isPage) postClass += ' post-page';
    if(isFeatured) postClass += ' post-featured';
    if(isSticky) postClass += ' post-sticky';

    // Post tags
    if(tags) {
      for(let i in tags) {
        postClass += ' tag-' + tags[i].slug;
      }
    }
    return chunk.write(postClass);
  };

  //
  // Returns the number of posts for a given author or tag.
  //
  // Posts can be filtered by any of the available flags using a `true` or `false` value. If an
  // argument is omitted, the flag will be ignored.
  //
  // The special flag `isPublic` can be used to filter by posts that are publicly visible.
  //
  // Examples:
  //
  //  {@postCount/}
  //  {@postCount author="bob"/}
  //  {@postCount tag="favorites"/}
  //  {@postCount author="bob" tag="favorites"/}
  //  {@postCount isPublic="true"/}
  //
  dust.helpers.postCount = (chunk, context, bodies, params) => {
    // Async wrapper
    return chunk.map((chunk) => {
      const locals = context.options.locals;
      const models = locals.Database.sequelize.models;
      let author = context.resolve(params.author);
      let tag = context.resolve(params.tag);
      let status = context.resolve(params.status);
      let isFeatured = context.resolve(params.isFeatured);
      let isPage = context.resolve(params.isPage);
      let isSticky = context.resolve(params.isSticky);
      let isPublic = context.resolve(params.isPublic);

      // Cast options to proper booleans
      if(typeof isFeatured !== 'undefined') isFeatured = (author === 'true');
      if(typeof isPage !== 'undefined') isPage = (isPage === 'true');
      if(typeof isSticky !== 'undefined') isSticky = (isSticky === 'true');
      if(typeof isPublic !== 'undefined') isPublic = (isPublic === 'true');

      // Get the count
      models.post
        .getCount({
          author,
          tag,
          status,
          isFeatured,
          isPage,
          isSticky,
          isPublic
        })
        .then((count) => {
          // Output the total
          chunk.write(count);

          return chunk.end();
        })
        .catch(() => chunk.end());
    });
  };

  //
  // Determines if a post is publicly visible (i.e. published but not scheduled). If no post is
  // specified, the current post context will be used.
  //
  // Examples:
  //
  //  {@isPublic}
  //    Post is public
  //  {:else}
  //    Post is not public
  //  {/isPublic}
  //
  dust.helpers.postIsPublic = (chunk, context, bodies, params) => {
    let post = context.resolve(params.post);
    let status = post ? post.status : context.get('status');
    let publishedAt = post ? post.publishedAt : context.get('publishedAt');

    // Post must be published
    if(status === 'published') {
      // Publish date can't be in the future
      let pubDate = new Moment(publishedAt);
      let now = new Moment.utc();

      if(pubDate.isSameOrBefore(now)) {
        chunk = bodies.block(chunk, context);
        return chunk;
      }
    }

    // Render else block
    if(bodies['else']) {
      chunk = chunk.render(bodies['else'], context);
    }

    return chunk;
  };

  //
  // Returns the approximate number of minutes to read the specified content. If no content is
  // specified, the current post context will be used.
  //
  // Examples:
  //
  //  {@readingTime/}
  //  {@readingTime content="Lorem ipsum..."/}
  //  {@readingTime wordPerMinute="225"/}
  //
  dust.helpers.readingTime = (chunk, context, bodies, params) => {
    let content = context.resolve(params.content) || context.get('content') || '';
    let text = Striptags(content);
    let numWords = text.split(' ').length;
    let wordsPerMinute = context.resolve(params.wordsPerMinute) || 225;

    return chunk.write(Math.max(1, Math.ceil(numWords / wordsPerMinute)));
  };

  //
  // Outputs the post title. If no post is specified, the title will be fetched from the current
  // context.
  //
  // Examples:
  //
  //  {@title/}
  //  {@title editable="true"/}
  //
  dust.helpers.title = (chunk, context, bodies, params) => {
    let isEditor = context.options.locals.isEditor;
    let editable = (context.resolve(params.editable) + '') === 'true';
    let post = context.resolve(params.post);
    let title = post ? post.title : context.get('title') || '';

    // Add editable wrappers when the post is being rendered in the editor
    if(isEditor && editable) {
      title = `
        <div
          data-postleaf-region="title"
          data-postleaf-html="` + He.encode(title, { useNamedReferences: true }) + `"
        >
          ` + title + `
        </div>
      `;
    }

    return chunk.write(title);
  };

};
